// TypeR-Setup.exe — one-click installer for TypeR for Photoshop (Windows).
//
// The plugin (TypeR.ccx) is embedded as a resource. Double-click:
//   1. with Adobe's plugin installer (UnifiedPluginInstallerAgent, part of the
//      Creative Cloud app): an older TypeR is removed, this one installed;
//   2. without it (no Creative Cloud app — the .ccx is then often associated
//      with Photoshop itself, which only answers "not the right kind of
//      document"), the setup does what Adobe's installer does: it unpacks the
//      plugin into  %CommonProgramFiles%\Adobe\UXP\Plugins\External\<id>_<version>
//      and registers it in  %ProgramData%\Adobe\UXP\PluginsInfo\v1\PS.json
//      (a backup PS.json.bak is kept). This needs administrator rights, so the
//      setup asks for them (UAC) only on this path;
//   3. a message says what happened.
// The same file updates an older TypeR.  TypeR-Setup.exe /uninstall  removes it.
//
// Test switches (no UI, no admin): /quiet /direct /root:<plugins dir> /info:<PS.json>
// Built by tools/build.mjs --ccx with the .NET Framework compiler (C# 5).

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("TypeR for Photoshop - Setup")]
[assembly: AssemblyProduct("TypeR for Photoshop")]
[assembly: AssemblyVersion("2.0.0.0")]

static class Setup
{
    const string Title = "TypeR";
    static readonly bool De = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "de";

    static bool quiet;          // no message boxes (tests)
    static bool forceDirect;    // skip Adobe's installer (tests)
    static bool uninstall;
    static string pluginsRoot;  // %CommonProgramFiles%\Adobe\UXP\Plugins
    static string pluginsInfo;  // %ProgramData%\Adobe\UXP\PluginsInfo\v1\PS.json
    static bool customPaths;

    static string T(string en, string de) { return De ? de : en; }

    [STAThread]
    static int Main(string[] args)
    {
        string common = Environment.GetEnvironmentVariable("CommonProgramW6432");
        if (string.IsNullOrEmpty(common)) common = Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFiles);
        pluginsRoot = Path.Combine(common, @"Adobe\UXP\Plugins");
        pluginsInfo = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), @"Adobe\UXP\PluginsInfo\v1\PS.json");
        foreach (string a in args)
        {
            string l = a.ToLowerInvariant();
            if (l == "/quiet") quiet = true;
            else if (l == "/direct") forceDirect = true;
            else if (l == "/uninstall") uninstall = true;
            else if (l.StartsWith("/root:")) { pluginsRoot = a.Substring(6); customPaths = true; }
            else if (l.StartsWith("/info:")) { pluginsInfo = a.Substring(6); customPaths = true; }
        }

        string ccx;
        Plugin plugin;
        try
        {
            ccx = Path.Combine(Path.GetTempPath(), "TypeR.ccx");
            using (Stream src = Assembly.GetExecutingAssembly().GetManifestResourceStream("TypeR.ccx"))
            using (FileStream dst = File.Create(ccx))
            {
                src.CopyTo(dst);
            }
            plugin = Plugin.FromCcx(ccx);
        }
        catch (Exception e)
        {
            Fail(T("Could not unpack the plugin:\n", "Das Plugin konnte nicht entpackt werden:\n") + e.Message);
            return 1;
        }

        string upia = forceDirect ? null : FindInstaller();

        if (uninstall)
        {
            string output;
            if (upia != null) Run(upia, "/remove \"" + plugin.Name + "\"", out output);
            if (!customPaths && NeedsElevation()) return Elevate(args);
            try
            {
                int n = RemoveDirect(plugin);
                Info(T("TypeR was removed. Restart Photoshop.", "TypeR wurde entfernt. Photoshop neu starten.") + (n == 0 && upia == null ? T("\n\n(It was not installed.)", "\n\n(Es war nicht installiert.)") : ""));
                return 0;
            }
            catch (Exception e)
            {
                Fail(T("Could not remove TypeR:\n\n", "TypeR konnte nicht entfernt werden:\n\n") + e.Message);
                return 1;
            }
        }

        string upiaProblem = null;
        if (upia != null)
        {
            string output;
            Run(upia, "/remove \"" + plugin.Name + "\"", out output);      // older version, if any
            int code = Run(upia, "/install \"" + ccx + "\"", out output);
            bool success = output.IndexOf("success", StringComparison.OrdinalIgnoreCase) >= 0;
            bool failed = !success && (code != 0 || output.IndexOf("fail", StringComparison.OrdinalIgnoreCase) >= 0);
            if (!failed)
            {
                Done();
                return 0;
            }
            upiaProblem = Short(output);
        }

        // no Creative Cloud installer (or it failed): install like it does
        if (!customPaths && NeedsElevation()) return Elevate(args);
        try
        {
            InstallDirect(ccx, plugin);
        }
        catch (Exception e)
        {
            Fail(T("Installation failed:\n\n", "Installation fehlgeschlagen:\n\n") + e.Message
                 + (upiaProblem != null ? T("\n\nAdobe's installer said:\n", "\n\nAdobes Installer meldete:\n") + upiaProblem : ""));
            return 1;
        }
        Done();
        return 0;
    }

    static void Done()
    {
        bool running = Process.GetProcessesByName("Photoshop").Length > 0;
        Info(T("TypeR is installed.\n\n", "TypeR ist installiert.\n\n")
             + (running ? T("Close Photoshop and start it again, then open TypeR with\nPlugins > TypeR > TypeR.",
                            "Photoshop schließen und neu starten, dann TypeR öffnen über\nPlugins > TypeR > TypeR.")
                        : T("Start Photoshop and open TypeR with\nPlugins > TypeR > TypeR.",
                            "Photoshop starten und TypeR öffnen über\nPlugins > TypeR > TypeR.")));
    }

    // --- direct install (what Adobe's installer writes) -----------------------

    class Plugin
    {
        public string Id, Name, Version, HostMin;

        public string Folder { get { return Id + "_" + Version; } }

        public static Plugin FromCcx(string ccx)
        {
            using (ZipArchive zip = ZipFile.OpenRead(ccx))
            {
                ZipArchiveEntry e = zip.GetEntry("manifest.json");
                if (e == null) throw new InvalidDataException("manifest.json missing");
                string json;
                using (StreamReader r = new StreamReader(e.Open(), Encoding.UTF8)) json = r.ReadToEnd();
                Dictionary<string, object> m = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
                Plugin p = new Plugin();
                p.Id = (string)m["id"];
                p.Name = (string)m["name"];
                p.Version = (string)m["version"];
                Dictionary<string, object> host = m["host"] as Dictionary<string, object>;
                p.HostMin = host != null && host.ContainsKey("minVersion") ? (string)host["minVersion"] : "24.0.0";
                return p;
            }
        }
    }

    static void InstallDirect(string ccx, Plugin p)
    {
        string external = Path.Combine(pluginsRoot, "External");
        Directory.CreateDirectory(external);
        RemoveFolders(p);
        string target = Path.Combine(external, p.Folder);
        ZipFile.ExtractToDirectory(ccx, target);

        List<object> plugins;
        Dictionary<string, object> doc = LoadInfo(out plugins);
        plugins.RemoveAll(delegate (object o) { return IsOurs(o, p); });
        Dictionary<string, object> entry = new Dictionary<string, object>();
        entry["hostMinVersion"] = p.HostMin;
        entry["name"] = p.Name;
        entry["path"] = "$localPlugins\\External\\" + p.Folder;
        entry["pluginId"] = p.Id;
        entry["status"] = "enabled";
        entry["type"] = "uxp";
        entry["versionString"] = p.Version;
        plugins.Add(entry);
        doc["plugins"] = plugins;
        SaveInfo(doc);
    }

    static int RemoveDirect(Plugin p)
    {
        int n = RemoveFolders(p);
        if (File.Exists(pluginsInfo))
        {
            List<object> plugins;
            Dictionary<string, object> doc = LoadInfo(out plugins);
            int removed = plugins.RemoveAll(delegate (object o) { return IsOurs(o, p); });
            if (removed > 0)
            {
                doc["plugins"] = plugins;
                SaveInfo(doc);
                n += removed;
            }
        }
        return n;
    }

    static int RemoveFolders(Plugin p)
    {
        string external = Path.Combine(pluginsRoot, "External");
        if (!Directory.Exists(external)) return 0;
        int n = 0;
        foreach (string d in Directory.GetDirectories(external, p.Id + "_*"))
        {
            Directory.Delete(d, true);
            n++;
        }
        return n;
    }

    static bool IsOurs(object o, Plugin p)
    {
        Dictionary<string, object> d = o as Dictionary<string, object>;
        return d != null && d.ContainsKey("pluginId") && (d["pluginId"] as string) == p.Id;
    }

    /// PS.json as a dictionary; a file that is there but unreadable is never
    /// overwritten (the other plugins' registrations live in it).
    static Dictionary<string, object> LoadInfo(out List<object> plugins)
    {
        Dictionary<string, object> doc = new Dictionary<string, object>();
        plugins = new List<object>();
        if (!File.Exists(pluginsInfo)) return doc;
        string json = File.ReadAllText(pluginsInfo, Encoding.UTF8);
        if (json.Trim().Length == 0) return doc;
        doc = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
        if (doc == null) throw new InvalidDataException(pluginsInfo + ": not a JSON object");
        if (doc.ContainsKey("plugins"))
        {
            ArrayList list = doc["plugins"] as ArrayList;
            if (list == null) throw new InvalidDataException(pluginsInfo + ": \"plugins\" is not a list");
            foreach (object o in list) plugins.Add(o);
        }
        return doc;
    }

    static void SaveInfo(Dictionary<string, object> doc)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(pluginsInfo));
        if (File.Exists(pluginsInfo)) File.Copy(pluginsInfo, pluginsInfo + ".bak", true);
        string json = new JavaScriptSerializer().Serialize(doc);
        File.WriteAllText(pluginsInfo, json, new UTF8Encoding(false));
    }

    // --- elevation ----------------------------------------------------------------

    static bool NeedsElevation()
    {
        try
        {
            return !new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch
        {
            return true;
        }
    }

    /// Run this setup again as administrator (Windows asks once) and pass its result on.
    static int Elevate(string[] args)
    {
        try
        {
            StringBuilder a = new StringBuilder();
            foreach (string s in args) a.Append("\"").Append(s).Append("\" ");
            ProcessStartInfo psi = new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, a.ToString());
            psi.UseShellExecute = true;
            psi.Verb = "runas";
            using (Process p = Process.Start(psi))
            {
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        catch (System.ComponentModel.Win32Exception)
        {
            Fail(T("Administrator rights are needed to install TypeR into Photoshop's plugin folder.\n\nPlease run the setup again and answer \"Yes\".",
                   "Zum Installieren in Photoshops Plugin-Ordner werden Administratorrechte gebraucht.\n\nBitte das Setup erneut starten und mit „Ja“ bestätigen."));
            return 1;
        }
    }

    // --- Adobe's installer --------------------------------------------------------

    static string FindInstaller()
    {
        const string rel = @"Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe";
        string[] roots = {
            Environment.GetEnvironmentVariable("CommonProgramW6432"),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFilesX86),
        };
        foreach (string root in roots)
        {
            if (string.IsNullOrEmpty(root)) continue;
            string p = Path.Combine(root, rel);
            if (File.Exists(p)) return p;
        }
        return null;
    }

    static int Run(string exe, string args, out string output)
    {
        output = "";
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(exe, args);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            using (Process p = Process.Start(psi))
            {
                string o = p.StandardOutput.ReadToEnd();
                string e = p.StandardError.ReadToEnd();
                p.WaitForExit(180000);
                output = (o + "\n" + e).Trim();
                return p.HasExited ? p.ExitCode : -1;
            }
        }
        catch (Exception e)
        {
            output = e.Message;
            return -1;
        }
    }

    static string Short(string s)
    {
        s = (s ?? "").Trim();
        return s.Length > 600 ? s.Substring(0, 600) + "…" : s;
    }

    static void Info(string msg)
    {
        if (quiet) Console.WriteLine(msg);
        else MessageBox.Show(msg, Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    static void Fail(string msg)
    {
        if (quiet) Console.Error.WriteLine(msg);
        else MessageBox.Show(msg, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
