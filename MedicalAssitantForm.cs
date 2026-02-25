using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using System;
using System.Data;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.Versioning;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Tesseract;

// FIX: avoid Image ambiguity between System.Drawing.Image and QuestPDF.Infrastructure.Image
using DrawingImage = System.Drawing.Image;
using DrawingBitmap = System.Drawing.Bitmap;

namespace CoPilotSymptomatologistWinApp
{
    [SupportedOSPlatform("windows6.1")]
    public partial class MedicalAssistantForm : Form
    {
        [SupportedOSPlatform("windows6.1")]
        public MedicalAssistantForm()
        {
            InitializeComponent();

            // Make RichTextBoxes behave like normal multiline text inputs (no risky P/Invoke).
            ConfigureRichTextBoxesAsPlain();
        }

        //==============================================================================================
        // IMPORTANT: Removed ALL RichEdit P/Invoke (EM_SETPARAFORMAT line spacing) to mitigate
        // random System.AccessViolationException crashes.

        private void ConfigureRichTextBoxesAsPlain()
        {
            // Safe: standard managed property sets only.
            SetPlainBehavior(PatientDemographics_richTextBox);
            SetPlainBehavior(VitalSign_richTextBox);
            SetPlainBehavior(ChiefComplaint_richTextBox);
            SetPlainBehavior(BasicInquiryHistoryofIllness_richTextBox);
            SetPlainBehavior(MedicationList_richTextBox);
            SetPlainBehavior(SocialHistory_richTextBox);
            SetPlainBehavior(Allergies_richTextBox);
            SetPlainBehavior(NotableFamilyMedicalHistory_richTextBox);
            SetPlainBehavior(PastMedicalHistory_richTextBox);
            SetPlainBehavior(ImmunizationHistory_richTextBox);
            SetPlainBehavior(LastClinicVisit_richTextBox);
            SetPlainBehavior(MedicalAssitantNote_richTextBox);

            // If the designer accidentally wired the Shown event to old handlers, detach defensively.
            this.Shown -= MedicalAssistantForm_Shown;
        }

        private static void SetPlainBehavior(RichTextBox rtb)
        {
            if (rtb == null) return;

            rtb.DetectUrls = false;
            rtb.HideSelection = false;
            rtb.ShortcutsEnabled = true;

            // "Normal textbox" feel:
            rtb.WordWrap = true;
            rtb.ScrollBars = RichTextBoxScrollBars.Vertical;
        }

        // Kept only to satisfy any Designer wiring; does nothing.
        private void MedicalAssistantForm_Shown(object? sender, EventArgs e) { }

        //==============================================================================================
        // --- Error handling helpers (throttled popups to avoid spam) ---
        private static readonly object _uiErrorLock = new();
        private static DateTime _lastUiErrorAt = DateTime.MinValue;
        private static string _lastUiErrorKey = "";

        // Show at most once per 2 seconds per "key" to prevent popup storms.
        private static void SafeUi(string key, Action action)
        {
            try
            {
                action();
            }
            catch (Exception ex)
            {
                ShowThrottledError(key, ex);
            }
        }

        private static void ShowThrottledError(string key, Exception ex)
        {
            lock (_uiErrorLock)
            {
                var now = DateTime.UtcNow;

                if (key == _lastUiErrorKey && (now - _lastUiErrorAt).TotalSeconds < 2)
                    return;

                _lastUiErrorKey = key;
                _lastUiErrorAt = now;
            }

            try
            {
                MessageBox.Show(
                    $"An error occurred in: {key}\n\n{ex.Message}",
                    "Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning
                );
            }
            catch
            {
                // swallow
            }
        }

        //==============================================================================================

        public class PatientIntakeData
        {
            public string FullName { get; set; } = string.Empty;
            public string DateOfBirth { get; set; } = string.Empty;
            public string Gender { get; set; } = string.Empty;
            public string Address { get; set; } = string.Empty;
            public string PhoneNumber { get; set; } = string.Empty;
            public string Email { get; set; } = string.Empty;
            public string ContactPerson { get; set; } = string.Empty;
            public string ContactNumber { get; set; } = string.Empty;

            public string BloodPressure { get; set; } = string.Empty;
            public string HeartRate { get; set; } = string.Empty;
            public string RespiratoryRate { get; set; } = string.Empty;
            public string Temperature { get; set; } = string.Empty;
            public string SpO2 { get; set; } = string.Empty;
            public string Height { get; set; } = string.Empty;
            public string Weight { get; set; } = string.Empty;
            public string BMI { get; set; } = string.Empty;

            public string ChiefComplaint { get; set; } = string.Empty;

            public string OnsetDate { get; set; } = string.Empty;
            public string Duration { get; set; } = string.Empty;
            public string Severity { get; set; } = string.Empty;
            public string Location { get; set; } = string.Empty;
            public string AssociatedSymptoms { get; set; } = string.Empty;

            public string Medications { get; set; } = string.Empty;
            public string OTCMeds { get; set; } = string.Empty;
            public string Supplements { get; set; } = string.Empty;

            public string SmokingStatus { get; set; } = string.Empty;
            public string AlcoholUse { get; set; } = string.Empty;
            public string DrugUse { get; set; } = string.Empty;

            public string Allergies { get; set; } = string.Empty;
            public string NotableFamilyMedicalHistory { get; set; } = string.Empty;
            public string PastMedicalHistory { get; set; } = string.Empty;
            public string ImmunizationHistory { get; set; } = string.Empty;
            public string LastClinicVisitNotes { get; set; } = string.Empty;
            public string MedicalAssistantNotes { get; set; } = string.Empty;

            public string AdditionalDemographicsNotes { get; set; } = string.Empty;
            public string AdditionalVitalNotes { get; set; } = string.Empty;
            public string AdditionalHistoryNotes { get; set; } = string.Empty;
            public string AdditionalMedicationNotes { get; set; } = string.Empty;
            public string AdditionalSocialNotes { get; set; } = string.Empty;
            public string AdditionalAllergyNotes { get; set; } = string.Empty;
            public string AdditionalFamilyHistoryNotes { get; set; } = string.Empty;
            public string AdditionalPastMedicalNotes { get; set; } = string.Empty;
            public string AdditionalImmunizationNotes { get; set; } = string.Empty;
            public string AdditionalLastClinicVisitNotes { get; set; } = string.Empty;
            public string AdditionalMedicalAssistantNotes { get; set; } = string.Empty;

            public string LabExtractedText1 { get; set; } = string.Empty;
            public string LabExtractedText2 { get; set; } = string.Empty;
            public string LabExtractedText3 { get; set; } = string.Empty;
            public string LabExtractedText4 { get; set; } = string.Empty;
            public string LabExtractedText5 { get; set; } = string.Empty;
            public string LabExtractedText6 { get; set; } = string.Empty;
        }

        //==============================================================================================
        // Replace the explicit constructor in PatientPdfDocument with a primary constructor
        public class PatientPdfDocument(PatientIntakeData data) : IDocument
        {
            private readonly PatientIntakeData _data = data;

            public DocumentMetadata GetMetadata() => DocumentMetadata.Default;

            public void Compose(IDocumentContainer container)
            {
                container.Page(page =>
                {
                    page.Margin(40);
                    page.Size(PageSizes.A4);
                    page.DefaultTextStyle(x => x.FontSize(12));

                    page.Content().Column(column =>
                    {
                        column.Item().Text("🩺 Patient Intake Summary").FontSize(20).Bold();
                        column.Item().Text($"🕒 Date: {DateTime.Now:f}").FontSize(10).Italic();
                        column.Item().PaddingVertical(10).LineHorizontal(1);

                        void AddSection(string title, string content)
                        {
                            column.Item().PaddingTop(10).Text($"{title}:").Bold().FontSize(13);
                            var safe = string.IsNullOrWhiteSpace(content) ? "-" : content.Trim();
                            column.Item().Text(safe).FontSize(11);
                        }

                        AddSection("Full Name", _data.FullName);
                        AddSection("Date of Birth", _data.DateOfBirth);
                        AddSection("Gender", _data.Gender);
                        AddSection("Address", _data.Address);
                        AddSection("Phone Number", _data.PhoneNumber);
                        AddSection("Email", _data.Email);
                        AddSection("Contact Person", _data.ContactPerson);
                        AddSection("Contact Number", _data.ContactNumber);

                        AddSection("Blood Pressure", _data.BloodPressure);
                        AddSection("Heart Rate", _data.HeartRate);
                        AddSection("Respiratory Rate", _data.RespiratoryRate);
                        AddSection("Temperature", _data.Temperature);
                        AddSection("SpO2", _data.SpO2);
                        AddSection("Height", _data.Height);
                        AddSection("Weight", _data.Weight);
                        AddSection("BMI", _data.BMI);

                        AddSection("Chief Complaint", _data.ChiefComplaint);
                        AddSection("Onset Date", _data.OnsetDate);
                        AddSection("Duration", _data.Duration);
                        AddSection("Severity", _data.Severity);
                        AddSection("Location", _data.Location);
                        AddSection("Associated Symptoms", _data.AssociatedSymptoms);

                        AddSection("Medications", _data.Medications);
                        AddSection("OTC Medications", _data.OTCMeds);
                        AddSection("Supplements", _data.Supplements);

                        AddSection("Smoking Status", _data.SmokingStatus);
                        AddSection("Alcohol Use", _data.AlcoholUse);
                        AddSection("Drug Use", _data.DrugUse);

                        AddSection("Allergies", _data.Allergies);
                        AddSection("Family Medical History", _data.NotableFamilyMedicalHistory);
                        AddSection("Past Medical History", _data.PastMedicalHistory);
                        AddSection("Immunization History", _data.ImmunizationHistory);

                        AddSection("Last Clinic Visit Notes", _data.LastClinicVisitNotes);
                        AddSection("Medical Assistant Notes", _data.MedicalAssistantNotes);

                        // OCR text can be very long; kept as-is but could be truncated/split later if needed.
                        AddSection("Laboratory Result 1 (OCR)", _data.LabExtractedText1);
                        AddSection("Laboratory Result 2 (OCR)", _data.LabExtractedText2);
                        AddSection("Laboratory Result 3 (OCR)", _data.LabExtractedText3);
                        AddSection("Laboratory Result 4 (OCR)", _data.LabExtractedText4);
                        AddSection("Laboratory Result 5 (OCR)", _data.LabExtractedText5);
                        AddSection("Laboratory Result 6 (OCR)", _data.LabExtractedText6);
                    });
                });
            }
        }

        //============================================================================================================
        // RichTextBox handlers
        // IMPORTANT: No P/Invoke, no text rewriting. Keep _TextChanged_1 only if Designer references it.

        private void PatientDemographics_richTextBox_TextChanged(object sender, EventArgs e)
        {
            // Normal behavior; intentionally empty.
        }

        private void PatientDemographics_richTextBox_TextChanged_1(object sender, EventArgs e)
        {
            PatientDemographics_richTextBox_TextChanged(sender, e);
        }

        private void VitalSign_richTextBox_TextChanged(object sender, EventArgs e) { }
        private void ChiefComplaint_richTextBox_TextChanged(object sender, EventArgs e) { }
        private void BasicInquiryHistoryofIllness_richTextBox_TextChanged(object sender, EventArgs e) { }
        private void MedicationList_richTextBox_TextChanged(object sender, EventArgs e) { }
        private void SocialHistory_richTextBox_TextChanged(object sender, EventArgs e) { }
        private void Allergies_richTextBox_TextChanged(object sender, EventArgs e) { }
        private void NotableFamilyMdeicalHistory_richTextBox_TextChanged(object sender, EventArgs e) { }
        private void PastMedicalHistory_richTextBox_TextChanged(object sender, EventArgs e) { }
        private void ImmunizationHistory_richTextBox_TextChanged(object sender, EventArgs e) { }
        private void LastClinicVisit_richTextBox_TextChanged(object sender, EventArgs e) { }
        private void MedicalAssitantNote_richTextBox_TextChanged(object sender, EventArgs e) { }

        //============================================================================================================
        private async void SaveData_button_Click(object sender, EventArgs e)
        {
            try
            {
                string[] demographicsLines = PatientDemographics_richTextBox.Text.Split(["\r\n", "\n"], StringSplitOptions.None);
                string[] vitalLines = VitalSign_richTextBox.Text.Split(["\r\n", "\n"], StringSplitOptions.None);
                string[] historyLines = BasicInquiryHistoryofIllness_richTextBox.Text.Split(["\r\n", "\n"], StringSplitOptions.None);
                string[] medsLines = MedicationList_richTextBox.Text.Split(["\r\n", "\n"], StringSplitOptions.None);
                string[] socialLines = SocialHistory_richTextBox.Text.Split(["\r\n", "\n"], StringSplitOptions.None);
                string[] allergiesLines = Allergies_richTextBox.Text.Split(["\r\n", "\n"], StringSplitOptions.None);
                string[] familyHistoryLines = NotableFamilyMedicalHistory_richTextBox.Text.Split(["\r\n", "\n"], StringSplitOptions.None);
                string[] pastMedicalLines = PastMedicalHistory_richTextBox.Text.Split(["\r\n", "\n"], StringSplitOptions.None);
                string[] immunizationLines = ImmunizationHistory_richTextBox.Text.Split(["\r\n", "\n"], StringSplitOptions.None);
                string[] lastclinicvistLines = LastClinicVisit_richTextBox.Text.Split(["\r\n", "\n"], StringSplitOptions.None);
                string[] medicalassitantnoteLines = MedicalAssitantNote_richTextBox.Text.Split(["\r\n", "\n"], StringSplitOptions.None);
                static string SafeLine(string[] lines, int index) => (index < lines.Length ? (lines[index] ?? "").Trim() : "N/A");

                var intake = new PatientIntakeData()
                {
                    FullName = SafeLine(demographicsLines, 0),
                    DateOfBirth = SafeLine(demographicsLines, 1),
                    Gender = SafeLine(demographicsLines, 2),
                    Address = SafeLine(demographicsLines, 3),
                    PhoneNumber = SafeLine(demographicsLines, 4),
                    Email = SafeLine(demographicsLines, 5),
                    ContactPerson = SafeLine(demographicsLines, 6),
                    ContactNumber = SafeLine(demographicsLines, 7),
                    AdditionalDemographicsNotes = string.Join("\n", demographicsLines.Skip(8)),

                    BloodPressure = SafeLine(vitalLines, 0),
                    HeartRate = SafeLine(vitalLines, 1),
                    RespiratoryRate = SafeLine(vitalLines, 2),
                    Temperature = SafeLine(vitalLines, 3),
                    SpO2 = SafeLine(vitalLines, 4),
                    Height = SafeLine(vitalLines, 5),
                    Weight = SafeLine(vitalLines, 6),
                    BMI = ComputeBmiOrFallback(SafeLine(vitalLines, 5), SafeLine(vitalLines, 6), SafeLine(vitalLines, 7)),
                    AdditionalVitalNotes = string.Join("\n", vitalLines.Skip(8)),

                    ChiefComplaint = (ChiefComplaint_richTextBox.Text ?? "").Trim(),

                    OnsetDate = SafeLine(historyLines, 0),
                    Duration = SafeLine(historyLines, 1),
                    Severity = SafeLine(historyLines, 2),
                    Location = SafeLine(historyLines, 3),
                    AssociatedSymptoms = SafeLine(historyLines, 4),
                    AdditionalHistoryNotes = string.Join("\n", historyLines.Skip(5)),

                    Medications = SafeLine(medsLines, 0),
                    OTCMeds = SafeLine(medsLines, 1),
                    Supplements = SafeLine(medsLines, 2),
                    AdditionalMedicationNotes = string.Join("\n", medsLines.Skip(3)),

                    SmokingStatus = SafeLine(socialLines, 0),
                    AlcoholUse = SafeLine(socialLines, 1),
                    DrugUse = SafeLine(socialLines, 2),
                    AdditionalSocialNotes = string.Join("\n", socialLines.Skip(3)),

                    Allergies = SafeLine(allergiesLines, 0),
                    AdditionalAllergyNotes = string.Join("\n", allergiesLines.Skip(1)),

                    NotableFamilyMedicalHistory = SafeLine(familyHistoryLines, 0),
                    AdditionalFamilyHistoryNotes = string.Join("\n", familyHistoryLines.Skip(1)),

                    PastMedicalHistory = SafeLine(pastMedicalLines, 0),
                    AdditionalPastMedicalNotes = string.Join("\n", pastMedicalLines.Skip(1)),

                    ImmunizationHistory = SafeLine(immunizationLines, 0),
                    AdditionalImmunizationNotes = string.Join("\n", immunizationLines.Skip(1)),

                    LastClinicVisitNotes = SafeLine(lastclinicvistLines, 0),
                    AdditionalLastClinicVisitNotes = string.Join("\n", lastclinicvistLines.Skip(1)),

                    MedicalAssistantNotes = SafeLine(medicalassitantnoteLines, 0),
                    AdditionalMedicalAssistantNotes = string.Join("\n", medicalassitantnoteLines.Skip(1)),

                    LabExtractedText1 = labResult1,
                    LabExtractedText2 = labResult2,
                    LabExtractedText3 = labResult3,
                    LabExtractedText4 = labResult4,
                    LabExtractedText5 = labResult5,
                    LabExtractedText6 = labResult6
                };

                string enhancedReport = await EnhanceReportWithGenAI(intake);

                GeneratePdfFromEnhancedText(enhancedReport, intake);
                GeneratePdfFromJson(intake);

                //MessageBox.Show("Enhanced report and intake summary PDF saved!");
            }
            catch (Exception ex)
            {
                MessageBox.Show("Error: " + ex.Message);
            }
        }

        //============================================================================================================
        private static string SanitizeForFilename(string input)
        {
            foreach (char c in Path.GetInvalidFileNameChars())
                input = input.Replace(c, '_');

            return input.Trim();
        }

        private static string GetTimestampForFilename() => DateTime.Now.ToString("yyyyMMdd_HHmmss_fff");

        private static void GeneratePdfFromEnhancedText(string reportText, PatientIntakeData intake)
        {
            string folderPath = @"C:\SymptomatologistCopilot_Records\AI_Report";
            Directory.CreateDirectory(folderPath);

            string namePart = SanitizeForFilename(intake.FullName);
            string dobPart = SanitizeForFilename(intake.DateOfBirth);
            string datePart = GetTimestampForFilename();
            string fileName = $"{namePart} ({dobPart}) {datePart}_AI.pdf";
            string pdfPath = Path.Combine(folderPath, fileName);

            Document.Create(container =>
            {
                container.Page(page =>
                {
                    page.Margin(40);
                    page.Size(PageSizes.A4);
                    page.DefaultTextStyle(x => x.FontSize(12));
                    page.Content().Column(column =>
                    {
                        string reportTitle = $"🧠 Patient Report: {intake.FullName} (DOB: {intake.DateOfBirth})";
                        column.Item().Text(reportTitle).FontSize(18).Bold();
                        column.Item().Text($"Generated: {DateTime.Now:f}").FontSize(10).Italic();
                        column.Item().PaddingVertical(10).LineHorizontal(1);

                        column.Item().Text(string.IsNullOrWhiteSpace(reportText) ? "-" : reportText).FontSize(11);
                    });
                });
            }).GeneratePdf(pdfPath);

            //MessageBox.Show("Enhanced AI report saved as PDF:\n" + pdfPath);
        }

        /// <summary>
        /// Generates the INTAKE PDF AND writes a deterministic JSON sidecar beside it.
        /// This enables future loads to avoid any PDF text extraction/parsing.
        /// </summary>
        private static void GeneratePdfFromJson(PatientIntakeData intake)
        {
            try
            {
                string folderPath = @"C:\SymptomatologistCopilot_Records\Patients";
                Directory.CreateDirectory(folderPath);

                string namePart = SanitizeForFilename(intake.FullName);
                string dobPart = SanitizeForFilename(intake.DateOfBirth);
                string datePart = GetTimestampForFilename();
                string fileName = $"{namePart} ({dobPart}) {datePart}_INTAKE.pdf";
                string pdfPath = Path.Combine(folderPath, fileName);

                var document = new PatientPdfDocument(intake);
                document.GeneratePdf(pdfPath);

                // ===== Save JSON sidecar beside the intake PDF (deterministic loader expects this) =====
                string jsonPath = Path.ChangeExtension(pdfPath, ".json");
                File.WriteAllText(jsonPath, JsonConvert.SerializeObject(intake, Formatting.Indented));

                MessageBox.Show("PDF generated:\n" + pdfPath);
            }
            catch (Exception ex)
            {
                MessageBox.Show("PDF generation failed:\n" + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static async Task<string> EnhanceReportWithGenAI(PatientIntakeData intake)
        {
            using var client = new HttpClient
            {
                Timeout = TimeSpan.FromMinutes(5)
            };

            var json = JsonConvert.SerializeObject(intake);
            var content = new StringContent(json, Encoding.UTF8);
            content.Headers.ContentType = new MediaTypeHeaderValue("application/json");

            try
            {
                var response = await client.PostAsync("http://127.0.0.1:8080/enhance-patient-report", content);
                response.EnsureSuccessStatusCode();

                var result = await response.Content.ReadAsStringAsync();

                if (!LooksLikeJson(result))
                    return result;

                try
                {
                    var token = JToken.Parse(result);

                    if (token is JObject obj)
                    {
                        JToken? enhancedToken =
                            obj["enhanced_report"] ??
                            obj["enhancedReport"] ??
                            obj["enhanced_report_text"] ??
                            obj["enhancedReportText"] ??
                            obj["enhanced"] ??
                            obj["report"] ??
                            obj["enhanced_report_md"] ??
                            obj["enhancedReportMd"];

                        if (enhancedToken == null || enhancedToken.Type == JTokenType.Null)
                            throw new InvalidOperationException($"The enhanced report is missing in the JSON response. Raw:\n{result}");

                        if (enhancedToken.Type == JTokenType.String)
                            return enhancedToken.Value<string>() ?? string.Empty;

                        return enhancedToken.ToString(Formatting.Indented);
                    }

                    if (token.Type == JTokenType.String)
                        return token.Value<string>() ?? string.Empty;

                    return token.ToString(Formatting.Indented);
                }
                catch (JsonReaderException)
                {
                    return result;
                }
            }
            catch (HttpRequestException ex)
            {
                MessageBox.Show($"Failed to reach the GenAI server:\n{ex.Message}", "AI Error");
                return "Error generating report.";
            }
            catch (TaskCanceledException)
            {
                MessageBox.Show("GenAI response timed out after 5 minutes.", "Timeout");
                return "Request timed out.";
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Unexpected error: {ex.Message}", "Error");
                return "An unexpected error occurred.";
            }
        }

        //============================================================================================================
        private string labResult1 = "", labResult2 = "", labResult3 = "", labResult4 = "", labResult5 = "", labResult6 = "";

        private static string ExtractTextFromImage(string imagePath)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(imagePath))
                    throw new ArgumentException("Image path is empty.", nameof(imagePath));

                if (!File.Exists(imagePath))
                    throw new FileNotFoundException("Image file not found.", imagePath);

                string baseDir = AppContext.BaseDirectory;

                string[] candidateTessdataDirs =
                [
                    Path.Combine(baseDir, "tessdata"),
                    Path.Combine(baseDir, "backend", "tessdata"),
                    Path.GetFullPath(Path.Combine(baseDir, "..", "backend", "tessdata")),
                    @"C:\Program Files\Tesseract-OCR\tessdata",
                    @"C:\Program Files (x86)\Tesseract-OCR\tessdata",
                ];

                string tessdataDir = candidateTessdataDirs.FirstOrDefault(Directory.Exists)
                    ?? throw new DirectoryNotFoundException(
                        "Could not find a tessdata directory. Checked:\n" +
                        string.Join("\n", candidateTessdataDirs));

                string engData = Path.Combine(tessdataDir, "eng.traineddata");
                if (!File.Exists(engData))
                    throw new FileNotFoundException(
                        $"Missing eng.traineddata at: {engData}\n" +
                        $"tessdataDir resolved to: {tessdataDir}");

                using var engine = new TesseractEngine(tessdataDir, "eng", EngineMode.Default);

                using var img = Pix.LoadFromFile(imagePath);
                using var page = engine.Process(img);

                return page.GetText() ?? string.Empty;
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"OCR Failed: {ex.Message}",
                    "OCR Init Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);

                return string.Empty;
            }
        }

        private static async Task<string> HandleLabTestUploadAsync(
            PictureBox pictureBoxTarget,
            string patientFullName,
            string patientDob,
            int labSlot // 1..6
        )
        {
            using var dialog = new OpenFileDialog
            {
                Filter = "Image Files|*.jpg;*.jpeg;*.png;*.bmp",
                Title = $"Select Laboratory Result (LR{labSlot})"
            };

            try
            {
                if (dialog.ShowDialog() != DialogResult.OK)
                    return string.Empty;

                string selectedPath = dialog.FileName;

                // Load image without locking the file:
                using (var fs = new FileStream(selectedPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                using (var temp = DrawingImage.FromStream(fs))
                {
                    pictureBoxTarget.Image?.Dispose();
                    pictureBoxTarget.Image = new DrawingBitmap(temp);
                }

                // OCR off UI thread
                string ocrResult = await Task.Run(() => ExtractTextFromImage(selectedPath));

                string preview = TruncateForUi(ocrResult, 1500);
                MessageBox.Show("OCR Text Extracted (preview):\n" + preview);

                // Save a copy of the uploaded image (lab result) using sanitized filename
                try
                {
                    string destFolder = @"C:\SymptomatologistCopilot_Records\Patients_Lab_Results";
                    Directory.CreateDirectory(destFolder);

                    string safeName = SanitizeForFilename(string.IsNullOrWhiteSpace(patientFullName) ? "Unknown Patient" : patientFullName);
                    string safeDob = SanitizeForFilename(string.IsNullOrWhiteSpace(patientDob) ? "Unknown DOB" : patientDob);

                    string ts = GetTimestampForFilename(); // yyyyMMdd_HHmmss_fff
                    string ext = Path.GetExtension(selectedPath);
                    if (string.IsNullOrWhiteSpace(ext)) ext = ".png";

                    // Example: Maria Lourdes Reyes (March 14, 1978) 20260105_140443_749_LR1.png
                    string fileName = $"{safeName} ({safeDob}) {ts}_LR{labSlot}{ext}";
                    string destPath = Path.Combine(destFolder, fileName);

                    File.Copy(selectedPath, destPath, overwrite: true);
                }
                catch (Exception copyEx)
                {
                    MessageBox.Show(
                        "OCR completed, but saving a copy of the lab image failed:\n" + copyEx.Message,
                        "Lab Result Save Warning",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning
                    );
                }

                return ocrResult;
            }
            catch (Exception ex)
            {
                MessageBox.Show("OCR Failed: " + ex.Message + "\n\nStackTrace:\n" + ex.StackTrace);
                return string.Empty;
            }
        }
        // Add this field to the class (near other static fields)
        private static readonly string[] NewLineSeparators = ["\r\n", "\n"];
        private async void MedLabPictureUpload1_button_Click(object sender, EventArgs e)
        {
            var demoLines = PatientDemographics_richTextBox.Text.Split(NewLineSeparators, StringSplitOptions.None);
            string fullName = demoLines.Length > 0 ? demoLines[0].Trim() : "";
            string dob = demoLines.Length > 1 ? demoLines[1].Trim() : "";

            labResult1 = await HandleLabTestUploadAsync(MedLabResult_pictureBox1, fullName, dob, 1);
            label1.Text = TruncateForUi(labResult1, 200);
        }

        private async void MedLabPictureUpload2_button_Click(object sender, EventArgs e)
        {
            var demoLines = PatientDemographics_richTextBox.Text.Split(NewLineSeparators, StringSplitOptions.None);
            string fullName = demoLines.Length > 0 ? demoLines[0].Trim() : "";
            string dob = demoLines.Length > 1 ? demoLines[1].Trim() : "";

            labResult2 = await HandleLabTestUploadAsync(MedLabResult_pictureBox2, fullName, dob, 2);
        }

        private async void MedLabPictureUpload3_button_Click(object sender, EventArgs e)
        {
            var demoLines = PatientDemographics_richTextBox.Text.Split(NewLineSeparators, StringSplitOptions.None);
            string fullName = demoLines.Length > 0 ? demoLines[0].Trim() : "";
            string dob = demoLines.Length > 1 ? demoLines[1].Trim() : "";

            labResult3 = await HandleLabTestUploadAsync(MedLabResult_pictureBox3, fullName, dob, 3);
        }

        private async void MedLabPictureUpload4_button_Click(object sender, EventArgs e)
        {
            var demoLines = PatientDemographics_richTextBox.Text.Split(NewLineSeparators, StringSplitOptions.None);
            string fullName = demoLines.Length > 0 ? demoLines[0].Trim() : "";
            string dob = demoLines.Length > 1 ? demoLines[1].Trim() : "";

            labResult4 = await HandleLabTestUploadAsync(MedLabResult_pictureBox4, fullName, dob, 4);
        }

        private async void MedLabPictureUpload5_button_Click(object sender, EventArgs e)
        {
            var demoLines = PatientDemographics_richTextBox.Text.Split(NewLineSeparators, StringSplitOptions.None);
            string fullName = demoLines.Length > 0 ? demoLines[0].Trim() : "";
            string dob = demoLines.Length > 1 ? demoLines[1].Trim() : "";

            labResult5 = await HandleLabTestUploadAsync(MedLabResult_pictureBox5, fullName, dob, 5);
        }

        private async void MedLabPictureUpload6_button_Click(object sender, EventArgs e)
        {
            var demoLines = PatientDemographics_richTextBox.Text.Split(NewLineSeparators, StringSplitOptions.None);
            string fullName = demoLines.Length > 0 ? demoLines[0].Trim() : "";
            string dob = demoLines.Length > 1 ? demoLines[1].Trim() : "";

            labResult6 = await HandleLabTestUploadAsync(MedLabResult_pictureBox6, fullName, dob, 6);
        }

        //============================================================================================================
        private void ClearData_button_Click(object sender, EventArgs e)
        {
            try
            {
                PatientDemographics_richTextBox.Clear();
                VitalSign_richTextBox.Clear();
                ChiefComplaint_richTextBox.Clear();
                BasicInquiryHistoryofIllness_richTextBox.Clear();
                MedicationList_richTextBox.Clear();
                SocialHistory_richTextBox.Clear();
                Allergies_richTextBox.Clear();
                NotableFamilyMedicalHistory_richTextBox.Clear();
                PastMedicalHistory_richTextBox.Clear();
                ImmunizationHistory_richTextBox.Clear();
                LastClinicVisit_richTextBox.Clear();
                MedicalAssitantNote_richTextBox.Clear();

                MedLabResult_pictureBox1.Image?.Dispose();
                MedLabResult_pictureBox2.Image?.Dispose();
                MedLabResult_pictureBox3.Image?.Dispose();
                MedLabResult_pictureBox4.Image?.Dispose();
                MedLabResult_pictureBox5.Image?.Dispose();
                MedLabResult_pictureBox6.Image?.Dispose();

                MedLabResult_pictureBox1.Image = null;
                MedLabResult_pictureBox2.Image = null;
                MedLabResult_pictureBox3.Image = null;
                MedLabResult_pictureBox4.Image = null;
                MedLabResult_pictureBox5.Image = null;
                MedLabResult_pictureBox6.Image = null;

                labResult1 = string.Empty;
                labResult2 = string.Empty;
                labResult3 = string.Empty;
                labResult4 = string.Empty;
                labResult5 = string.Empty;
                labResult6 = string.Empty;

                label1.Text = string.Empty;

                MessageBox.Show("All fields have been cleared.");
            }
            catch (Exception ex)
            {
                MessageBox.Show("Clear failed:\n" + ex.Message);
            }
        }

        //============================================================================================================
        // Helpers

        private static string TruncateForUi(string? text, int maxChars)
        {
            if (string.IsNullOrEmpty(text))
                return string.Empty;

            if (text.Length <= maxChars)
                return text;

            return text[..maxChars] + "\n... (truncated)";
        }

        private static bool LooksLikeJson(string? s)
        {
            if (string.IsNullOrWhiteSpace(s))
                return false;

            s = s.TrimStart();
            return s.StartsWith('{') ||
                   s.StartsWith('[') ||
                   s.StartsWith('"');
        }

        private static string ComputeBmiOrFallback(string heightRaw, string weightRaw, string bmiFallbackRaw)
        {
            if (TryParseHeightMeters(heightRaw, out double meters) && TryParseWeightKg(weightRaw, out double kg))
            {
                if (meters > 0 && kg > 0)
                {
                    double bmi = kg / (meters * meters);
                    if (double.IsFinite(bmi) && bmi > 0)
                        return bmi.ToString("0.0", CultureInfo.InvariantCulture);
                }
            }

            var fallback = (bmiFallbackRaw ?? "").Trim();
            return string.IsNullOrWhiteSpace(fallback) ? "N/A" : fallback;
        }

        private static bool TryParseHeightMeters(string raw, out double meters)
        {
            meters = 0;

            if (string.IsNullOrWhiteSpace(raw))
                return false;

            string s = raw.Trim().ToLowerInvariant();
            s = s.Replace("height", "").Replace(":", "").Trim();

            if (s.Contains("cm"))
            {
                if (TryExtractNumber(s, out double cm) && cm > 0)
                {
                    meters = cm / 100.0;
                    return true;
                }
                return false;
            }

            if (s.Contains('m'))
            {
                if (TryExtractNumber(s, out double m) && m > 0)
                {
                    if (m > 3.0) return false;
                    meters = m;
                    return true;
                }
                return false;
            }

            if (TryExtractNumber(s, out double n) && n > 0)
            {
                meters = (n > 3.0) ? n / 100.0 : n;
                return true;
            }

            return false;
        }

        private static bool TryParseWeightKg(string raw, out double kg)
        {
            kg = 0;

            if (string.IsNullOrWhiteSpace(raw))
                return false;

            string s = raw.Trim().ToLowerInvariant();
            s = s.Replace("weight", "").Replace(":", "").Trim();

            if (s.Contains("lb") || s.Contains("lbs"))
            {
                if (TryExtractNumber(s, out double lbs) && lbs > 0)
                {
                    kg = lbs * 0.45359237;
                    return true;
                }
                return false;
            }

            if (s.Contains("kg"))
            {
                if (TryExtractNumber(s, out double k) && k > 0)
                {
                    kg = k;
                    return true;
                }
                return false;
            }

            if (TryExtractNumber(s, out double n) && n > 0)
            {
                kg = n;
                return true;
            }

            return false;
        }

        private static bool TryExtractNumber(string s, out double value)
        {
            value = 0;

            var filtered = new string([.. s.Where(c => char.IsDigit(c) || c == '.' || c == ',' || c == '-')]).Trim();
            if (string.IsNullOrWhiteSpace(filtered))
                return false;

            filtered = filtered.Replace(',', '.');
            return double.TryParse(filtered, NumberStyles.Float, CultureInfo.InvariantCulture, out value);
        }

        //============================================================================================================
        // Search + Preview + Load (deterministic: JSON sidecar only)
        private void SearchFileSystem_button_Click(object sender, EventArgs e)
        {
            SafeUi("SearchFileSystem", () =>
            {
                string patientsFolder = @"C:\SymptomatologistCopilot_Records\Patients";
                Directory.CreateDirectory(patientsFolder);

                using var dialog = new OpenFileDialog
                {
                    InitialDirectory = patientsFolder,
                    Filter = "Patient Intake PDF|*_INTAKE.pdf|PDF Files|*.pdf",
                    Title = "Select a Patient Intake PDF",
                    Multiselect = false
                };

                while (true)
                {
                    if (dialog.ShowDialog(this) != DialogResult.OK)
                        return;

                    string selectedPdf = dialog.FileName;

                    // Preview window with explicit actions:
                    // OK = Use this, Retry = Choose another, Cancel = exit
                    using var preview = new PdfPreviewForm(selectedPdf);
                    var decision = preview.ShowDialog(this);

                    if (decision == DialogResult.Retry)
                        continue;

                    if (decision != DialogResult.OK)
                        return;

                    // Load & populate
                    LoadPatientFromSelectedPdf(selectedPdf);

                    MessageBox.Show("Patient record loaded into the form.", "Loaded", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
            });
        }

        // OPTION A (RECOMMENDED): Stop parsing PDF text; load the JSON sidecar only.
        private void LoadPatientFromSelectedPdf(string selectedPdfPath)
        {
            string jsonPath = Path.ChangeExtension(selectedPdfPath, ".json");

            if (!File.Exists(jsonPath))
                throw new InvalidOperationException(
                    "This INTAKE PDF has no matching .json data file.\n\n" +
                    "Expected sidecar:\n" + Path.GetFileName(jsonPath) + "\n\n" +
                    "Fix:\n" +
                    "When saving the INTAKE PDF, also save the JSON beside it.\n" +
                    "Once the JSON exists, Search File will load the patient correctly."
                );

            var json = File.ReadAllText(jsonPath);
            var intake = JsonConvert.DeserializeObject<PatientIntakeData>(json)
                         ?? throw new InvalidOperationException("Failed to deserialize intake JSON.");

            PopulateFormFromIntake(intake);
        }

        private void PopulateFormFromIntake(PatientIntakeData intake)
        {
            PatientDemographics_richTextBox.Text =
                $"{intake.FullName}\n{intake.DateOfBirth}\n{intake.Gender}\n{intake.Address}\n{intake.PhoneNumber}\n{intake.Email}\n{intake.ContactPerson}\n{intake.ContactNumber}" +
                (string.IsNullOrWhiteSpace(intake.AdditionalDemographicsNotes) ? "" : "\n" + intake.AdditionalDemographicsNotes);

            VitalSign_richTextBox.Text =
                $"{intake.BloodPressure}\n{intake.HeartRate}\n{intake.RespiratoryRate}\n{intake.Temperature}\n{intake.SpO2}\n{intake.Height}\n{intake.Weight}\n{intake.BMI}" +
                (string.IsNullOrWhiteSpace(intake.AdditionalVitalNotes) ? "" : "\n" + intake.AdditionalVitalNotes);

            ChiefComplaint_richTextBox.Text = intake.ChiefComplaint ?? "";

            BasicInquiryHistoryofIllness_richTextBox.Text =
                $"{intake.OnsetDate}\n{intake.Duration}\n{intake.Severity}\n{intake.Location}\n{intake.AssociatedSymptoms}" +
                (string.IsNullOrWhiteSpace(intake.AdditionalHistoryNotes) ? "" : "\n" + intake.AdditionalHistoryNotes);

            MedicationList_richTextBox.Text =
                $"{intake.Medications}\n{intake.OTCMeds}\n{intake.Supplements}" +
                (string.IsNullOrWhiteSpace(intake.AdditionalMedicationNotes) ? "" : "\n" + intake.AdditionalMedicationNotes);

            SocialHistory_richTextBox.Text =
                $"{intake.SmokingStatus}\n{intake.AlcoholUse}\n{intake.DrugUse}" +
                (string.IsNullOrWhiteSpace(intake.AdditionalSocialNotes) ? "" : "\n" + intake.AdditionalSocialNotes);

            Allergies_richTextBox.Text =
                $"{intake.Allergies}" +
                (string.IsNullOrWhiteSpace(intake.AdditionalAllergyNotes) ? "" : "\n" + intake.AdditionalAllergyNotes);

            NotableFamilyMedicalHistory_richTextBox.Text =
                $"{intake.NotableFamilyMedicalHistory}" +
                (string.IsNullOrWhiteSpace(intake.AdditionalFamilyHistoryNotes) ? "" : "\n" + intake.AdditionalFamilyHistoryNotes);

            PastMedicalHistory_richTextBox.Text =
                $"{intake.PastMedicalHistory}" +
                (string.IsNullOrWhiteSpace(intake.AdditionalPastMedicalNotes) ? "" : "\n" + intake.AdditionalPastMedicalNotes);

            ImmunizationHistory_richTextBox.Text =
                $"{intake.ImmunizationHistory}" +
                (string.IsNullOrWhiteSpace(intake.AdditionalImmunizationNotes) ? "" : "\n" + intake.AdditionalImmunizationNotes);

            LastClinicVisit_richTextBox.Text =
                $"{intake.LastClinicVisitNotes}" +
                (string.IsNullOrWhiteSpace(intake.AdditionalLastClinicVisitNotes) ? "" : "\n" + intake.AdditionalLastClinicVisitNotes);

            MedicalAssitantNote_richTextBox.Text =
                $"{intake.MedicalAssistantNotes}" +
                (string.IsNullOrWhiteSpace(intake.AdditionalMedicalAssistantNotes) ? "" : "\n" + intake.AdditionalMedicalAssistantNotes);

            // Restore labResult variables
            labResult1 = intake.LabExtractedText1 ?? "";
            labResult2 = intake.LabExtractedText2 ?? "";
            labResult3 = intake.LabExtractedText3 ?? "";
            labResult4 = intake.LabExtractedText4 ?? "";
            labResult5 = intake.LabExtractedText5 ?? "";
            labResult6 = intake.LabExtractedText6 ?? "";

            label1.Text = TruncateForUi(labResult1, 200);
        }

        /// <summary>
        /// Preview window with explicit user actions:
        /// - Use this (DialogResult.OK)
        /// - Choose another (DialogResult.Retry)
        /// - Cancel/X (DialogResult.Cancel)
        ///
        /// Note: This does not embed a PDF renderer (no extra dependencies).
        /// It provides a clean UX and can open the PDF in the default viewer.
        /// </summary>
        public class PdfPreviewForm : Form
        {
            private readonly string _pdfPath;

            public PdfPreviewForm(string pdfPath)
            {
                _pdfPath = pdfPath;

                Text = "PDF Preview";
                Width = 900;
                Height = 220;
                StartPosition = FormStartPosition.CenterParent;
                MinimizeBox = false;
                MaximizeBox = false;

                var lbl = new Label
                {
                    Text = Path.GetFileName(_pdfPath),
                    Dock = DockStyle.Top,
                    Height = 40,
                    Padding = new Padding(12, 12, 12, 0),
                    AutoEllipsis = true
                };

                var btnOpen = new Button
                {
                    Text = "Open in Default Viewer",
                    Width = 200,
                    Height = 34
                };
                btnOpen.Click += (_, __) =>
                {
                    try
                    {
                        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                        {
                            FileName = _pdfPath,
                            UseShellExecute = true
                        });
                    }
                    catch (Exception ex)
                    {
                        MessageBox.Show("Unable to open PDF:\n" + ex.Message, "Open Error");
                    }
                };

                var btnUse = new Button
                {
                    Text = "Use this",
                    Width = 120,
                    Height = 34,
                    DialogResult = DialogResult.OK
                };

                var btnChooseAnother = new Button
                {
                    Text = "Choose another",
                    Width = 140,
                    Height = 34,
                    DialogResult = DialogResult.Retry
                };

                var btnCancel = new Button
                {
                    Text = "Cancel",
                    Width = 120,
                    Height = 34,
                    DialogResult = DialogResult.Cancel
                };

                var bar = new FlowLayoutPanel
                {
                    Dock = DockStyle.Bottom,
                    Height = 64,
                    FlowDirection = FlowDirection.RightToLeft,
                    Padding = new Padding(12, 12, 12, 12),
                    WrapContents = false
                };

                bar.Controls.Add(btnUse);
                bar.Controls.Add(btnChooseAnother);
                bar.Controls.Add(btnCancel);
                bar.Controls.Add(btnOpen);

                Controls.Add(bar);
                Controls.Add(lbl);

                AcceptButton = btnUse;
                CancelButton = btnCancel;
            }
        }

        // =============================================================================================
        // NOTE:
        // ExtractPdfText(...) and TryParseIntakeFromPdfText(...) are no longer needed under Option A.
        // They have been intentionally removed from the load path to ensure deterministic behavior.
    }
}
