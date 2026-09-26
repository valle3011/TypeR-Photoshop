// TypeR-Setup.exe — one-click installer for TypeR for Photoshop (Windows).
//
// The plugin (TypeR.ccx) is embedded as a resource. Double-click:
//   1. the .ccx is written to %TEMP%,
//   2. Adobe's plugin installer (UnifiedPluginInstallerAgent, part of the
//      Creative Cloud app) removes an older TypeR and installs this one —
//      so the same file also updates,
//   3. without that installer the .ccx is handed to the Creative Cloud app,
//   4. a message says what happened.
// Built by tools/build.mjs --ccx with the .NET Framework compiler (C# 5).

using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("TypeR for Photoshop - Setup")]
[assembly: AssemblyProduct("TypeR for Photoshop")]
[assembly: AssemblyVersion("2.0.0.0")]

static class Setup
{
    const string Title = "TypeR";
    static readonly bool De = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "de";

    static string T(string en, string de) { return De ? de : en; }

    [STAThread]
    static int Main()
    {
        string ccx;
        try
        {
            ccx = Path.Combine(Path.GetTempPath(), "TypeR.ccx");
            using (Stream src = Assembly.GetExecutingAssembly().GetManifestResourceStream("TypeR.ccx"))
            using (FileStream dst = File.Create(ccx))
            {
                src.CopyTo(dst);
            }
        }
        catch (Exception e)
        {
            Fail(T("Could not unpack the plugin:\n", "Das Plugin konnte nicht entpackt werden:\n") + e.Message);
            return 1;
        }

        string upia = FindInstaller();
        if (upia != null)
        {
            string output;
            Run(upia, "/remove \"TypeR\"", out output);                // older version, if any
            int code = Run(upia, "/install \"" + ccx + "\"", out output);
            bool success = output.IndexOf("success", StringComparison.OrdinalIgnoreCase) >= 0;
            bool failed = !success && (code != 0 || output.IndexOf("fail", StringComparison.OrdinalIgnoreCase) >= 0);
            if (!failed)
            {
                Info(T("TypeR is installed.\n\nRestart Photoshop, then open it with\nPlugins > TypeR > TypeR.",
                       "TypeR ist installiert.\n\nPhotoshop neu starten, dann öffnen über\nPlugins > TypeR > TypeR."));
                return 0;
            }
            if (TryOpen(ccx))
            {
                Info(T("Adobe's installer reported a problem:\n\n" + Short(output) + "\n\nThe plugin was handed to the Creative Cloud app instead — please confirm the installation there, then restart Photoshop.",
                       "Adobes Installer meldete ein Problem:\n\n" + Short(output) + "\n\nDas Plugin wurde stattdessen an die Creative Cloud App übergeben – bitte dort die Installation bestätigen und danach Photoshop neu starten."));
                return 0;
            }
            Fail(T("Installation failed:\n\n", "Installation fehlgeschlagen:\n\n") + Short(output));
            return 1;
        }

        if (TryOpen(ccx))
        {
            Info(T("The plugin was handed to the Creative Cloud app — please confirm the installation there, then restart Photoshop.",
                   "Das Plugin wurde an die Creative Cloud App übergeben – bitte dort die Installation bestätigen und danach Photoshop neu starten."));
            return 0;
        }
        Fail(T("Adobe's plugin installer was not found.\n\nPlease install the Creative Cloud desktop app (it comes with Photoshop) and run this setup again.",
               "Adobes Plugin-Installer wurde nicht gefunden.\n\nBitte die Creative Cloud Desktop-App installieren (gehört zu Photoshop) und dieses Setup erneut starten."));
        return 1;
    }

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

    static bool TryOpen(string path)
    {
        try
        {
            Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            return true;
        }
        catch
        {
            return false;
        }
    }

    static string Short(string s)
    {
        s = (s ?? "").Trim();
        return s.Length > 600 ? s.Substring(0, 600) + "…" : s;
    }

    static void Info(string msg) { MessageBox.Show(msg, Title, MessageBoxButtons.OK, MessageBoxIcon.Information); }
    static void Fail(string msg) { MessageBox.Show(msg, Title, MessageBoxButtons.OK, MessageBoxIcon.Error); }
}
