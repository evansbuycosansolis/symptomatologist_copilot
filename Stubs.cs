using System;
using System.Windows.Forms;

namespace CoPilotSymptomatologistWinApp
{
	internal class Stubs
	{
	}

	public class TrainAIForm : Form
	{
		public TrainAIForm()
		{
			Text = "Train AI (stub)";
			StartPosition = FormStartPosition.CenterParent;
			Width = 600;
			Height = 400;
		}
	}

	// IMPORTANT:
	// Do NOT declare MedicalReferencesForm here.
	// The real MedicalReferencesForm exists as a WinForms partial class (Designer + code-behind).
	// Keeping a stub with the same name causes "missing partial modifier" + ambiguous constructor errors.

	public class MedicationLookupForrm : Form
	{
		// Your main form reads this after ShowDialog()
		public string RetrievedDrugInfo { get; set; } = "No data (stub)";

		public MedicationLookupForrm()
		{
			Text = "Medication Lookup (stub)";
			StartPosition = FormStartPosition.CenterParent;
			Width = 600;
			Height = 400;

			var ok = new Button { Text = "OK", DialogResult = DialogResult.OK, Dock = DockStyle.Bottom, Height = 36 };
			Controls.Add(ok);
		}
	}

	public class MedicalRecordsViewForm : Form
	{
		// Your main form subscribes to this
		public event Action<string>? PdfFileSelected;

		public MedicalRecordsViewForm()
		{
			Text = "Medical Records Viewer (stub)";
			StartPosition = FormStartPosition.CenterParent;
			Width = 800;
			Height = 600;

			var choose = new Button { Text = "Choose PDF (stub)", Dock = DockStyle.Bottom, Height = 36 };
			choose.Click += (s, e) =>
			{
				using var ofd = new OpenFileDialog { Filter = "PDF files (*.pdf)|*.pdf" };
				if (ofd.ShowDialog() == DialogResult.OK)
					PdfFileSelected?.Invoke(ofd.FileName);

				DialogResult = DialogResult.OK;
				Close();
			};
			Controls.Add(choose);
		}
	}
}
