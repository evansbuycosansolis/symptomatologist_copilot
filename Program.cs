
using System;
using System.Runtime.Versioning;
using System.Windows.Forms;
using QuestPDF.Infrastructure;

namespace CoPilotSymptomatologistWinApp
{
    internal static class Program
    {
        /// <summary>
        ///  The main entry point for the application.
        /// </summary>
        [STAThread]
        [SupportedOSPlatform("windows6.1")]
        static void Main()
        {
            // To customize application configuration such as set high DPI settings or default font,
            // see https://aka.ms/applicationconfiguration.
            QuestPDF.Settings.License = LicenseType.Community;

            ApplicationConfiguration.Initialize();

			Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);

			Application.ThreadException += (s, e) =>
			{
				MessageBox.Show(e.Exception.Message, "Unhandled UI Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
			};

			AppDomain.CurrentDomain.UnhandledException += (s, e) =>
			{
				var ex = e.ExceptionObject as Exception;
				MessageBox.Show(ex?.Message ?? "Unknown error", "Unhandled Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
			};

			TaskScheduler.UnobservedTaskException += (s, e) =>
			{
				MessageBox.Show(e.Exception.Message, "Background Task Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
				e.SetObserved();
			};

			Application.Run(new MainForm());
        }
    }
}