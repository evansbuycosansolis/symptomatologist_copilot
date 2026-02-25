using Microsoft.VisualBasic;
using NAudio.Wave;
using Newtonsoft.Json.Linq;
using PdfiumViewer;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Printing;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.Versioning;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Vosk;

namespace CoPilotSymptomatologistWinApp
{
    [SupportedOSPlatform("windows6.1")]




    public partial class MedicalDoctorForm : Form
    {
        // ===================== Constants / Config =====================
        private const string BackendBaseUrl = "http://localhost:8080";
        private static readonly TimeSpan HttpTimeout = TimeSpan.FromSeconds(60);

        // ===================== Regex (fields, no GeneratedRegex for older C#) =====================
#if NET7_0_OR_GREATER
        [GeneratedRegex(@"[^a-z0-9_.-]+", RegexOptions.CultureInvariant | RegexOptions.Compiled)]
        private static partial Regex NonAlphaNumUnderscoreRegex();

        [GeneratedRegex(@"\W+", RegexOptions.CultureInvariant | RegexOptions.Compiled)]
        private static partial Regex TokenSplitRegex();
#else
        private static readonly Regex NonAlphaNumUnderscoreRegex =
            new Regex(@"[^a-z0-9_.-]+", RegexOptions.CultureInvariant | RegexOptions.Compiled);

        private static readonly Regex TokenSplitRegex =
            new Regex(@"\W+", RegexOptions.CultureInvariant | RegexOptions.Compiled);
#endif
        private static readonly TimeSpan ReviseTimeout = TimeSpan.FromSeconds(120);

        // ===================== Chat history (single source of truth) =====================
        private readonly List<ChatMessage> chatHistory = [];

        // Vosk / audio
        private Model? _voskModel;
        private VoskRecognizer? _recognizer;
        private WaveInEvent? _waveIn;
        private bool _voskListening;

        // PdfiumViewer resources
        private PdfViewer? _patientPdfViewer;
        private PdfDocument? _patientPdfDoc;
        private MemoryStream? _patientPdfStream;

        // Track the currently displayed patient PDF (on disk)
        private string? _currentPatientPdfPath;

        // Reuse one HttpClient
        private static readonly HttpClient Http = new()
        {
            Timeout = TimeSpan.FromMinutes(5) //  increase from default 100s or your configured 60
        };

        // Reusable separators to avoid repeated array allocations
        private static readonly char[] SpaceSeparator = [' '];
        private static readonly char[] CommaSeparator = [','];

        public MedicalDoctorForm()
        {
            InitializeComponent();

            // If designer already wires events, this is still safe (double-wire is avoided by not wiring twice in designer).
            AIChat_button.Click += AIChat_button_Click_1;
            AIChat_textBox.KeyDown += AIChat_textBox_KeyDown;

            // Ensure we clean up audio + PDF resources
            this.FormClosed += (s, e) =>
            {
                StopVoskRecognition();
                DisposePatientPdf();
            };
        }

        // ===================== UI Prompt Helpers =====================

        private static string? PromptForMedicationName()
        {
            using var form = new Form
            {
                Width = 420,
                Height = 150,
                Text = "Medication Lookup",
                StartPosition = FormStartPosition.CenterParent,
                FormBorderStyle = FormBorderStyle.FixedDialog,
                MaximizeBox = false,
                MinimizeBox = false
            };

            var label = new Label
            {
                Text = "Enter medication name:",
                Left = 20,
                Top = 15,
                AutoSize = true
            };

            var textBox = new TextBox
            {
                Left = 20,
                Top = 40,
                Width = 360
            };

            var okButton = new Button
            {
                Text = "Search",
                Left = 280,
                Width = 100,
                Top = 75,
                DialogResult = DialogResult.OK
            };

            form.Controls.Add(label);
            form.Controls.Add(textBox);
            form.Controls.Add(okButton);

            form.AcceptButton = okButton;

            return form.ShowDialog() == DialogResult.OK
                ? textBox.Text.Trim()
                : null;
        }

        // ===================== Helpers: Slug + filename =====================

        private static string Slugify(string s)
        {
            s ??= "patient_record";
            s = s.Trim().ToLowerInvariant();
#if NET7_0_OR_GREATER
            s = NonAlphaNumUnderscoreRegex().Replace(s, "_");
#else
            s = NonAlphaNumUnderscoreRegex.Replace(s, "_");
#endif
            s = s.Trim('_', '.');
            return string.IsNullOrEmpty(s) ? "patient_record" : s;
        }

        private static string MakePatientRecordFileName(string note)
        {
            var firstLine = (note ?? "")
                .Replace("\r", "")
                .Split('\n')
                .FirstOrDefault(l => !string.IsNullOrWhiteSpace(l)) ?? "patient_record";
            var slug = Slugify(firstLine);
            return $"{slug}_{DateTime.Now:yyyyMMdd_HHmmss}.pdf";
        }

        // ===================== PubMed web search helpers =====================

        private static readonly HashSet<string> CommonStopWords = new(StringComparer.OrdinalIgnoreCase)
        {
            "with","without","patient","report","present","history","acute","chronic","pain","and","the",
            "that","this","have","from","which","into","about","over","under","been","were","has","had",
            "will","would","could","should","for","also","than","then","there","their","them","they",
            "male","female","year","years","old"
        };

        private static string BuildPubMedQueryFromNote(string note, int maxTerms = 12)
        {
#if NET7_0_OR_GREATER
            var tokens = TokenSplitRegex()
                .Split((note ?? string.Empty).ToLowerInvariant())
#else
            var tokens = TokenSplitRegex
                .Split((note ?? string.Empty).ToLowerInvariant())
#endif
                .Where(t => t.Length >= 4 && !CommonStopWords.Contains(t))
                .Distinct()
                .Take(maxTerms)
                .ToArray();

            if (tokens.Length == 0)
                return "clinical case report diagnosis treatment";

            return string.Join(" AND ", tokens.Select(t => $"\"{t}\""));
        }

        private static string ExtractYear(string pubdate)
        {
            if (string.IsNullOrWhiteSpace(pubdate)) return string.Empty;

            // Grab first 4 digits run found in string
            var digits = new string([.. pubdate.SkipWhile(c => !char.IsDigit(c)).Take(4)]);
            return digits.Length == 4 ? digits : string.Empty;
        }

        private static async Task<List<string>> SearchPubMedAsync(string note, int maxResults = 5)
        {
            var results = new List<string>();
            try
            {
                string tool = "CoPilotSymptomatologistWinApp";
                string query = BuildPubMedQueryFromNote(note);

                string searchUrl =
                    $"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmax={maxResults}&sort=relevance&retmode=json&term={Uri.EscapeDataString(query)}&tool={tool}";

                var esearch = await Http.GetStringAsync(searchUrl);
                using var sdoc = JsonDocument.Parse(esearch);
                var idListElem = sdoc.RootElement
                    .GetProperty("esearchresult")
                    .GetProperty("idlist");

                var ids = idListElem.EnumerateArray()
                    .Select(e => e.GetString())
                    .Where(s => !string.IsNullOrWhiteSpace(s))
                    .ToList();

                if (ids.Count == 0) return results;

                string idsCsv = string.Join(",", ids);
                string summaryUrl =
                    $"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id={idsCsv}&tool={tool}";

                var esummary = await Http.GetStringAsync(summaryUrl);
                using var sumdoc = JsonDocument.Parse(esummary);
                var root = sumdoc.RootElement.GetProperty("result");

                var uids = root.GetProperty("uids")
                    .EnumerateArray()
                    .Select(u => u.GetString())
                    .Where(u => !string.IsNullOrWhiteSpace(u))
                    .ToList();

                foreach (var uid in uids)
                {
                    var item = root.GetProperty(uid!);
                    string pmid = uid!;
                    string title = item.TryGetProperty("title", out var t) ? (t.GetString() ?? "(no title)") : "(no title)";
                    string journal = item.TryGetProperty("fulljournalname", out var j) ? (j.GetString() ?? "") : "";
                    string pubdate = item.TryGetProperty("pubdate", out var d) ? (d.GetString() ?? "") : "";
                    string year = ExtractYear(pubdate);
                    string url = $"https://pubmed.ncbi.nlm.nih.gov/{pmid}/";

                    string line = $"• {title} — {journal}{(string.IsNullOrEmpty(year) ? "" : $" ({year})")}. PMID: {pmid}. {url}";
                    results.Add(line);
                }
            }
            catch
            {
                // swallow; caller will handle empty results
            }
            return results;
        }

        // ===================== Analyze Patient Case (Autopilot) =====================

        private void ResetAnalysisProgress()
        {
            AIAnalysis_progressBar.MarqueeAnimationSpeed = 0;
            AIAnalysis_progressBar.Style = ProgressBarStyle.Blocks;
            AIAnalysis_progressBar.Visible = false;
        }

        // ===================== Attach PDF (local summarize; no upload) =====================

        private bool ShowQuickPdfPreview(string pdfPath)
        {
            try
            {
                using var doc = PdfDocument.Load(pdfPath);
                using var viewer = new PdfViewer { Dock = DockStyle.Fill, Document = doc };
                using var frm = new Form
                {
                    Text = $"Preview: {Path.GetFileName(pdfPath)}",
                    StartPosition = FormStartPosition.CenterParent,
                    Width = 800,
                    Height = 900
                };

                var ok = new Button { Text = "Use this", DialogResult = DialogResult.OK, Dock = DockStyle.Bottom, Height = 36 };
                var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, Dock = DockStyle.Bottom, Height = 36 };

                frm.Controls.Add(viewer);
                frm.Controls.Add(ok);
                frm.Controls.Add(cancel);

                var result = frm.ShowDialog(this);

                if (result == DialogResult.OK)
                {
                    MessageBox.Show(
                        "File selected. Generating a summary now — it will be inserted into the Doctor's Note.",
                        "Processing",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information
                    );
                }

                return result == DialogResult.OK;
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Preview failed:\n{ex.Message}", "Preview Error");
                return false;
            }
        }

        private static string ExtractPlainTextFromPdf(string path, int maxPages = 5, int maxChars = 8000)
        {
            var sb = new StringBuilder();
            using var doc = PdfDocument.Load(path);
            int pages = Math.Min(doc.PageCount, maxPages);

            for (int i = 0; i < pages && sb.Length < maxChars; i++)
            {
                var pageText = doc.GetPdfText(i) ?? string.Empty;
                if (pageText.Length + sb.Length > maxChars)
                    pageText = pageText[..Math.Max(0, maxChars - sb.Length)];
                sb.AppendLine(pageText);
            }

            return sb.ToString();
        }

        // ===================== Patient Records (PDF) =====================

        /// <summary>
        /// Compatibility wrapper: if designer binds to PatientRecords_button_Click, delegate to _1.
        /// </summary>
        private void PatientRecords_button_Click(object sender, EventArgs e)
        {
            PatientRecords_button_Click_1(sender, e);
        }

        // Keep this if your Designer references it; delegates to PatientRecords handler.
        private void RetrievePatientData_button_Click(object? sender, EventArgs e)
        {
            PatientRecords_button_Click(sender ?? this, e);
        }

        private void DisposePatientPdf()
        {
            try { _patientPdfDoc?.Dispose(); } catch { }
            _patientPdfDoc = null;

            try { _patientPdfStream?.Dispose(); } catch { }
            _patientPdfStream = null;

            try { _patientPdfViewer?.Dispose(); } catch { }
            _patientPdfViewer = null;

            PatientRecord_panel.Controls.Clear();
            _currentPatientPdfPath = null;
        }

        private void ShowPdfInPatientRecordPanel(string pdfFilePath)
        {
            _currentPatientPdfPath = pdfFilePath;

            DisposePatientPdf();

            var bytes = File.ReadAllBytes(pdfFilePath);
            _patientPdfStream = new MemoryStream(bytes);
            _patientPdfDoc = PdfDocument.Load(_patientPdfStream);

            _patientPdfViewer = new PdfViewer
            {
                Dock = DockStyle.Fill,
                Document = _patientPdfDoc
            };

            PatientRecord_panel.Controls.Add(_patientPdfViewer);
            _patientPdfViewer.BringToFront();
        }

        // ===================== Attach ANY file (PDF/Image/Text/Other) =====================

        private async void AttachFile_button_Click_1(object sender, EventArgs e)
        {
            using var ofd = new OpenFileDialog
            {
                Filter =
                    "Supported files|*.pdf;*.png;*.jpg;*.jpeg;*.bmp;*.tif;*.tiff;*.txt;*.csv|" +
                    "PDF files (*.pdf)|*.pdf|" +
                    "Image files (*.png;*.jpg;*.jpeg;*.bmp;*.tif;*.tiff)|*.png;*.jpg;*.jpeg;*.bmp;*.tif;*.tiff|" +
                    "Text files (*.txt;*.csv)|*.txt;*.csv|" +
                    "All files (*.*)|*.*",
                Multiselect = false
            };

            if (ofd.ShowDialog() != DialogResult.OK) return;

            var path = ofd.FileName;
            var ext = Path.GetExtension(path)?.ToLowerInvariant() ?? "";

            try
            {
                // --- PDF ---
                if (ext == ".pdf")
                {
                    if (!ShowQuickPdfPreview(path)) return;

                    string extracted = "";
                    try
                    {
                        extracted = ExtractPlainTextFromPdf(path, maxPages: 5, maxChars: 12000);
                    }
                    catch (Exception exPdfText)
                    {
                        MessageBox.Show($"PDF text extraction failed:\n{exPdfText.Message}", "PDF Error");
                        extracted = "";
                    }

                    if (!string.IsNullOrWhiteSpace(extracted) && extracted.Trim().Length >= 30)
                    {
                        DoctorsNote_richTextBox.AppendText(
                            $"\n\n[Attachment: PDF → Text]\nFile: {Path.GetFileName(path)}\n\n{extracted.Trim()}\n");

                        await TryAppendAiSummaryAsync(Path.GetFileName(path), extracted);
                        return;
                    }

                    using var bmp = TryRenderFirstPdfPageToBitmap(path);
                    if (bmp != null)
                    {
                        DoctorsNote_richTextBox.AppendText($"\n\n[Attachment: PDF → Image]\nFile: {Path.GetFileName(path)}\n");
                        PasteImageIntoRichTextBox(DoctorsNote_richTextBox, bmp);
                        DoctorsNote_richTextBox.AppendText("\n");
                        return;
                    }

                    DoctorsNote_richTextBox.AppendText(
                        $"\n\n[Attachment: PDF]\nFile: {Path.GetFileName(path)}\nPath: {path}\n(Note: Could not extract text or render preview.)\n");
                    return;
                }

                // --- Image ---
                if (IsImageExtension(ext))
                {
                    string ocrText = await TryOcrImageAsync(path);
                    if (!string.IsNullOrWhiteSpace(ocrText) && ocrText.Trim().Length >= 10)
                    {
                        DoctorsNote_richTextBox.AppendText(
                            $"\n\n[Attachment: Image → OCR Text]\nFile: {Path.GetFileName(path)}\n\n{ocrText.Trim()}\n");
                        return;
                    }

                    using var imgBmp = LoadBitmapNoLock(path);
                    DoctorsNote_richTextBox.AppendText($"\n\n[Attachment: Image]\nFile: {Path.GetFileName(path)}\n");
                    PasteImageIntoRichTextBox(DoctorsNote_richTextBox, imgBmp);
                    DoctorsNote_richTextBox.AppendText("\n");
                    return;
                }

                // --- Plain text files ---
                if (ext == ".txt" || ext == ".csv")
                {
                    string text = await File.ReadAllTextAsync(path);
                    text = string.IsNullOrWhiteSpace(text) ? "(empty file)" : text.Trim();

                    DoctorsNote_richTextBox.AppendText(
                        $"\n\n[Attachment: Text File]\nFile: {Path.GetFileName(path)}\n\n{text}\n");
                    return;
                }

                // --- Any other file type ---
                DoctorsNote_richTextBox.AppendText(
                    $"\n\n[Attachment: File]\nFile: {Path.GetFileName(path)}\nPath: {path}\n" +
                    "(Note: This file type is not text/OCR supported. Kept as a reference.)\n");
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Attach file failed:\n{ex.Message}", "Error");
            }
        }

        // ===================== Attach Helpers =====================

        private static bool IsImageExtension(string ext) =>
            ext is ".png" or ".jpg" or ".jpeg" or ".bmp" or ".tif" or ".tiff";

        private static Bitmap LoadBitmapNoLock(string imagePath)
        {
            using var fs = new FileStream(imagePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var temp = Image.FromStream(fs);
            return new Bitmap(temp);
        }

        private static void PasteImageIntoRichTextBox(RichTextBox rtb, Bitmap bmp)
        {
            try
            {
                IDataObject? backup = null;
                try { backup = Clipboard.GetDataObject(); } catch { }

                try
                {
                    Clipboard.SetImage(bmp);
                    rtb.ReadOnly = false;
                    rtb.Paste();
                }
                finally
                {
                    try
                    {
                        if (backup != null) Clipboard.SetDataObject(backup);
                    }
                    catch { }
                }
            }
            catch
            {
                rtb.AppendText("\n[Image attachment failed to paste.]\n");
            }
        }

        private static Bitmap? TryRenderFirstPdfPageToBitmap(string pdfPath)
        {
            try
            {
                using var doc = PdfiumViewer.PdfDocument.Load(pdfPath);
                if (doc.PageCount <= 0) return null;

                const int width = 1200;
                const int height = 1600;

                var img = doc.Render(0, width, height, 150, 150, PdfiumViewer.PdfRenderFlags.Annotations);
                return new Bitmap(img);
            }
            catch
            {
                return null;
            }
        }

        private static async Task<string> TryOcrImageAsync(string imagePath)
        {
            return await Task.Run(() =>
            {
                try
                {
                    if (string.IsNullOrWhiteSpace(imagePath) || !File.Exists(imagePath))
                        return string.Empty;

                    string baseDir = AppContext.BaseDirectory;

                    // Same resolution strategy as ExtractTextFromImage (portable)
                    string[] candidateTessdataDirs =
                    [
                // 1) Recommended: tessdata shipped with desktop app
                Path.Combine(baseDir, "tessdata"),

                // 2a) Backend next to exe
                Path.Combine(baseDir, "backend", "tessdata"),

                // 2b) Backend one level up
                Path.GetFullPath(Path.Combine(baseDir, "..", "backend", "tessdata")),

                // 3) Optional system installs
                @"C:\Program Files\Tesseract-OCR\tessdata",
                @"C:\Program Files (x86)\Tesseract-OCR\tessdata",
            ];

                    // 👇 nullable on purpose
                    string? tessdataDir = candidateTessdataDirs
                        .FirstOrDefault(Directory.Exists);

                    if (string.IsNullOrEmpty(tessdataDir))
                        return string.Empty;

                    string engData = Path.Combine(tessdataDir, "eng.traineddata");
                    if (!File.Exists(engData))
                        return string.Empty;

                    using var engine = new Tesseract.TesseractEngine(
                        tessdataDir,
                        "eng",
                        Tesseract.EngineMode.Default
                    );

                    using var img = Tesseract.Pix.LoadFromFile(imagePath);
                    using var page = engine.Process(img);

                    return page.GetText() ?? string.Empty;
                }
                catch
                {
                    // Silent failure by design (background OCR)
                    return string.Empty;
                }
            });
        }


        private async Task TryAppendAiSummaryAsync(string fileName, string extracted)
        {
            try
            {
                var prompt = new[]
                {
                    new { role = "system", content = "You are a clinical summarizer. Produce a concise 6–10 sentence summary suitable for a doctor's note." },
                    new { role = "user", content = $"Summarize this content:\n\n{extracted}" }
                };

                var resp = await Http.PostAsJsonAsync($"{BackendBaseUrl}/chat", new { history = prompt });
                if (!resp.IsSuccessStatusCode) return;

                var json = await resp.Content.ReadFromJsonAsync<Dictionary<string, string>>();
                var summary = json != null && json.TryGetValue("reply", out var reply) ? reply : "";

                if (!string.IsNullOrWhiteSpace(summary))
                {
                    DoctorsNote_richTextBox.AppendText(
                        $"\n[AI Summary of {fileName}]\n{summary.Trim()}\n");
                }
            }
            catch
            {
                // Non-fatal
            }
        }

        // ===================== Analyze Case =====================

        private async void AnalyzePatientCase_button_Click_1(object sender, EventArgs e)
        {
            AIAnalysis_progressBar.Visible = true;
            AIAnalysis_progressBar.Style = ProgressBarStyle.Marquee;
            AIAnalysis_progressBar.MarqueeAnimationSpeed = 30;

            var note = DoctorsNote_richTextBox.Text.Trim();
            if (string.IsNullOrEmpty(note))
            {
                ResetAnalysisProgress();
                MessageBox.Show("Doctor's note is empty.", "Info");
                return;
            }

            try
            {
                DoctorsNote_richTextBox.AppendText("\n\n===== Autopilot: Literature Scout (web model) =====\n");

                var webScoutPrompt = new[]
                {
                    new { role = "system", content =
                        "You are an expert clinical literature scout. Using your knowledge, propose the 5 most relevant, credible medical references for the following case. " +
                        "For each item, include: Title; Source (journal/org + year if known); DOI/PMID if you know it; 2–3 line clinical relevance summary. " +
                        "If you're not fully certain, clearly mark it as 'Likely match'."},
                    new { role = "user", content = note }
                };

                var webScoutResp = await Http.PostAsJsonAsync($"{BackendBaseUrl}/chat", new { history = webScoutPrompt });
                webScoutResp.EnsureSuccessStatusCode();
                var webScoutJson = await webScoutResp.Content.ReadFromJsonAsync<Dictionary<string, string>>();
                var webScout = webScoutJson != null && webScoutJson.TryGetValue("reply", out var reply1) ? reply1 : "(no suggestions)";
                DoctorsNote_richTextBox.AppendText(webScout.Trim() + "\n");

                DoctorsNote_richTextBox.AppendText("\n===== Autopilot: Web — Similar cases & findings (PubMed) =====\n");
                DoctorsNote_richTextBox.AppendText("[Searching PubMed…]\n");

                var pubmed = await SearchPubMedAsync(note, maxResults: 5);
                if (pubmed.Count > 0)
                {
                    foreach (var line in pubmed)
                        DoctorsNote_richTextBox.AppendText(line + "\n");
                }
                else
                {
                    DoctorsNote_richTextBox.AppendText("No PubMed matches found for the current note.\n");
                }

                DoctorsNote_richTextBox.AppendText("\n===== Autopilot: Local References (RAG) =====\n");

                var listResp = await Http.GetFromJsonAsync<RefsDto>($"{BackendBaseUrl}/list_references");
                var allRefs = listResp?.Files ?? [];
                var candidates = allRefs.Take(8).ToList();

                var picked = new List<(string name, string summary)>();
                foreach (var fn in candidates)
                {
                    var askPayload = new
                    {
                        filename = fn,
                        history = new[]
                        {
                            new { role = "user", content =
                                $"Given this patient case, provide a 2–4 sentence summary of how **{fn}** is relevant (or say 'not relevant'):\n\n{note}" }
                        }
                    };

                    var askResp = await Http.PostAsJsonAsync($"{BackendBaseUrl}/ask_pdf", askPayload);
                    if (!askResp.IsSuccessStatusCode) continue;

                    var askJson = await askResp.Content.ReadFromJsonAsync<Dictionary<string, string>>();
                    var ans = askJson != null && askJson.TryGetValue("answer", out var reply2) ? reply2 : "";
                    if (!string.IsNullOrWhiteSpace(ans) &&
                        !ans.Contains("No relevant information", StringComparison.OrdinalIgnoreCase))
                    {
                        picked.Add((fn, ans.Trim()));
                    }
                }

                if (picked.Count > 0)
                {
                    foreach (var (name, summary) in picked.OrderByDescending(p => p.summary.Length).Take(3))
                    {
                        DoctorsNote_richTextBox.AppendText($"\n• {name}\n{summary}\n");
                    }
                }
                else
                {
                    DoctorsNote_richTextBox.AppendText("No clearly relevant local references found.\n");
                }

                DoctorsNote_richTextBox.AppendText("\n===== Autopilot: Clinical Analysis =====\n");
                var refNames = picked.Select(p => p.name).ToList();
                var analyzePayload = new { note, reference_names = refNames };

                var analyzeResp = await Http.PostAsJsonAsync($"{BackendBaseUrl}/analyze_case", analyzePayload);
                analyzeResp.EnsureSuccessStatusCode();
                var analyzeJson = await analyzeResp.Content.ReadFromJsonAsync<Dictionary<string, string>>();
                var analysis = analyzeJson != null && analyzeJson.TryGetValue("analysis", out var reply3) ? reply3 : "No analysis generated.";
                AIAnalysis_richTextBox.Text = analysis.Trim();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Autopilot analyze failed:\n{ex.Message}", "Error");
            }
            finally
            {
                ResetAnalysisProgress();
            }
        }

        // ===================== Revise note =====================

        private async void ReviseMedicalReport_button_Click_1(object sender, EventArgs e)
        {
            using var cts = new CancellationTokenSource(ReviseTimeout);
            DoctorsNote_progressBar.Visible = true;
            DoctorsNote_progressBar.Style = ProgressBarStyle.Marquee;
            DoctorsNote_progressBar.MarqueeAnimationSpeed = 30;

            var clickedControl = sender as Control;
            bool restoreEnabled = false;
            if (clickedControl != null)
            {
                restoreEnabled = clickedControl.Enabled;
                clickedControl.Enabled = false;
            }

            this.UseWaitCursor = true;

            try
            {
                string originalNote = DoctorsNote_richTextBox.Text.Trim();
                if (string.IsNullOrEmpty(originalNote))
                {
                    MessageBox.Show("Doctor's note is empty.", "Information");
                    return;
                }

                // OPTIONAL: prevent extremely large payloads from slowing the request
                // (Tune as needed; WinForms RichTextBox can get huge with pasted PDFs/OCR)
                const int MAX_CHARS = 20000;
                if (originalNote.Length > MAX_CHARS)
                    originalNote = originalNote[..MAX_CHARS];

                var history = new[]
                {
            new
            {
                role = "system",
                content =
@"You are an expert medical scribe and clinician. Rewrite the following doctor's note as a formal, structured medical report.

CRITICAL REQUIREMENTS:
1) Include EVERY piece of information present in the note—do NOT omit, compress away, or generalize any facts. Preserve all symptoms (pos/neg), exam findings, measurements, values, units, dates/times, medications (names/doses/routes/frequency), allergies, family/social history, labs/imaging, and any free-text comments.
2) You may reorganize and clarify, but keep all facts intact. If wording is ambiguous or conflicting, include the original phrasing verbatim in an ""As documented"" subsection while also providing your clarified version.
3) If you cannot confidently map something to a standard section, place it under ""Other Documented Details"" so that NOTHING is lost.
4) Suggested sections (use those that apply): Chief Complaint; HPI; ROS; Past Medical History; Medications; Allergies; Social History; Family History; Physical Exam; Studies/Labs/Imaging; Assessment; Plan; Attachments & Summaries; Other Documented Details.
5) Do not drop duplicate but non-identical lines; retain both. Maintain numeric values and units exactly as written."
            },
            new { role = "user", content = originalNote }
        };

                // IMPORTANT: per-request cancellation timeout (independent of HttpClient.Timeout)
                // Set longer than your previous 60s.
                using var response = await Http.PostAsJsonAsync(
              $"{BackendBaseUrl}/chat",
              new { history },
              cts.Token
                      );

                response.EnsureSuccessStatusCode();

                var result = await response.Content.ReadFromJsonAsync<Dictionary<string, string>>(cancellationToken: cts.Token);
                string aiReply = result != null && result.TryGetValue("reply", out var r) ? r : "No response from AI.";


                using var preview = new Form
                {
                    Text = "Preview Revised Medical Report",
                    StartPosition = FormStartPosition.CenterParent,
                    Width = 900,
                    Height = 700,
                    MinimizeBox = false,
                    MaximizeBox = true,
                    FormBorderStyle = FormBorderStyle.Sizable
                };

                var rtb = new RichTextBox
                {
                    Dock = DockStyle.Fill,
                    ReadOnly = true,
                    Multiline = true,
                    WordWrap = false,
                    Font = new Font("Segoe UI", 9f),
                    Text = aiReply
                };

                var bottomBar = new FlowLayoutPanel
                {
                    Dock = DockStyle.Bottom,
                    Height = 52,
                    Padding = new Padding(10, 10, 10, 10),
                    FlowDirection = FlowDirection.RightToLeft,
                    WrapContents = false
                };

                var cancelBtn = new Button
                {
                    Text = "Cancel",
                    DialogResult = DialogResult.Cancel,
                    Width = 110,
                    Height = 30,
                    Margin = new Padding(8, 0, 0, 0)
                };

                var useBtn = new Button
                {
                    Text = "Use this",
                    DialogResult = DialogResult.OK,
                    Width = 110,
                    Height = 30,
                    Margin = new Padding(0, 0, 0, 0)
                };

                bottomBar.Controls.Add(cancelBtn);
                bottomBar.Controls.Add(useBtn);

                preview.AcceptButton = useBtn;
                preview.CancelButton = cancelBtn;

                preview.Controls.Add(rtb);
                preview.Controls.Add(bottomBar);

                if (preview.ShowDialog(this) == DialogResult.OK)
                {
                    DoctorsNote_richTextBox.Text = aiReply.Trim();
                }
            }
            catch (TaskCanceledException)
            {
                MessageBox.Show(
                    "AI revision timed out. The backend took too long to respond.\n\n" +
                    "Tip: Try again, or shorten the note, or increase backend OpenAI timeout limits.",
                    "Timeout",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning
                );
            }
            catch (HttpRequestException ex)
            {
                MessageBox.Show(
                    "AI revision failed (HTTP).\n\n" + ex.Message,
                    "Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
            catch (Exception ex)
            {
                MessageBox.Show("AI revision failed:\n" + ex.Message, "Error");
            }
            finally
            {
                DoctorsNote_progressBar.MarqueeAnimationSpeed = 0;
                DoctorsNote_progressBar.Style = ProgressBarStyle.Blocks;
                DoctorsNote_progressBar.Visible = false;

                clickedControl?.Enabled = restoreEnabled;
                this.UseWaitCursor = false;
            }
        }



        // ===================== RAG helper DTO =====================

        private sealed class RefsDto
        {
            [JsonPropertyName("files")]
            public List<string> Files { get; set; } = [];
        }

        private sealed class TrainStatusDto
        {
            [JsonPropertyName("trained_documents")]
            public int TrainedDocuments { get; set; }

            [JsonPropertyName("documents")]
            public List<TrainDocDto> Documents { get; set; } = [];
        }

        private sealed class TrainDocDto
        {
            [JsonPropertyName("filename")]
            public string Filename { get; set; } = "";

            [JsonPropertyName("tags")]
            public List<string> Tags { get; set; } = [];

            [JsonPropertyName("added_at")]
            public string AddedAt { get; set; } = "";
        }

        private async Task<string?> EnsurePatientPdfIndexedAsync()
        {
            if (string.IsNullOrWhiteSpace(_currentPatientPdfPath) || !File.Exists(_currentPatientPdfPath))
                return null;

            using var form = new MultipartFormDataContent();
            using var fs = File.OpenRead(_currentPatientPdfPath);
            var streamContent = new StreamContent(fs);
            streamContent.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
            var fname = Path.GetFileName(_currentPatientPdfPath) ?? "patient.pdf";
            form.Add(streamContent, "pdf", fname);

            var resp = await Http.PostAsync($"{BackendBaseUrl}/upload_pdf", form);
            resp.EnsureSuccessStatusCode();

            var json = await resp.Content.ReadFromJsonAsync<Dictionary<string, string>>();
            return (json != null && json.TryGetValue("filename", out var outName)) ? outName : null;
        }

        // ===================== Compile Patient Record (PDF via Print-to-PDF) =====================

        private static void EnsureMicrosoftPrintToPdfInstalled()
        {
            var installed = PrinterSettings.InstalledPrinters
                .Cast<string>()
                .Any(p => string.Equals(p, "Microsoft Print to PDF", StringComparison.OrdinalIgnoreCase));

            if (!installed)
                throw new InvalidOperationException("The printer 'Microsoft Print to PDF' is not installed. Enable it in Windows Features or install a PDF printer.");
        }

        private static void WritePdfFromText(string text, string fullPath)
        {
            EnsureMicrosoftPrintToPdfInstalled();

            using var pd = new PrintDocument
            {
                PrintController = new StandardPrintController(),
                PrinterSettings =
                {
                    PrinterName = "Microsoft Print to PDF",
                    PrintToFile = true,
                    PrintFileName = fullPath
                }
            };

            using var font = new Font("Segoe UI", 11f);
            string[] paragraphs = (text ?? string.Empty).Replace("\r", "").Split('\n');

            int currentParagraph = 0;

            pd.PrintPage += (s, e) =>
            {
                if (e.Graphics == null)
                    throw new InvalidOperationException("Graphics object is null.");

                float left = e.MarginBounds.Left;
                float top = e.MarginBounds.Top;
                float width = e.MarginBounds.Width;
                float height = e.MarginBounds.Height;
                float lineHeight = e.Graphics.MeasureString("Ag", font).Height * 1.2f;

                float y = top;

                while (currentParagraph < paragraphs.Length)
                {
                    string para = paragraphs[currentParagraph];
                    var words = para.Split(SpaceSeparator, StringSplitOptions.None);
                    var line = new StringBuilder();

                    foreach (var w in words)
                    {
                        string candidate = line.Length == 0 ? w : $"{line} {w}";
                        var size = e.Graphics.MeasureString(candidate, font);
                        if (size.Width > width)
                        {
                            e.Graphics.DrawString(line.ToString(), font, Brushes.Black,
                                new RectangleF(left, y, width, lineHeight));
                            y += lineHeight;

                            if (y + lineHeight > top + height)
                            {
                                e.HasMorePages = true;
                                return;
                            }

                            line.Clear();
                            line.Append(w);
                        }
                        else
                        {
                            line.Clear();
                            line.Append(candidate);
                        }
                    }

                    if (line.Length > 0)
                    {
                        e.Graphics.DrawString(line.ToString(), font, Brushes.Black,
                            new RectangleF(left, y, width, lineHeight));
                        y += lineHeight;

                        if (y + lineHeight > top + height)
                        {
                            e.HasMorePages = true;
                            return;
                        }
                    }

                    y += lineHeight * 0.5f;
                    if (y + lineHeight > top + height)
                    {
                        e.HasMorePages = true;
                        return;
                    }

                    currentParagraph++;
                }

                e.HasMorePages = false;
            };

            var dir = Path.GetDirectoryName(fullPath);
            if (!string.IsNullOrEmpty(dir))
                Directory.CreateDirectory(dir);

            pd.Print();
        }

        private async void CompilePatientRecord_button_Click_1(object sender, EventArgs e)
        {
            var note = DoctorsNote_richTextBox.Text.Trim();
            if (string.IsNullOrEmpty(note))
            {
                MessageBox.Show("Doctor's note is empty.", "Info");
                return;
            }

            string patientsDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "backend", "patients");
            string fileName = MakePatientRecordFileName(note);
            string fullPath = Path.Combine(patientsDir, fileName);

            try
            {
                WritePdfFromText(note, fullPath);

                try
                {
                    using var form = new MultipartFormDataContent();
                    using var fs = File.OpenRead(fullPath);
                    var sc = new StreamContent(fs);
                    sc.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
                    var outName = Path.GetFileName(fullPath) ?? "patient_record.pdf";
                    form.Add(sc, "pdf", outName);

                    var resp = await Http.PostAsync($"{BackendBaseUrl}/upload_pdf", form);
                    resp.EnsureSuccessStatusCode();
                }
                catch (Exception exIndex)
                {
                    MessageBox.Show($"PDF saved but indexing failed:\n{exIndex.Message}", "Partial Success");
                    return;
                }

                MessageBox.Show($"Patient record saved and indexed:\n{fullPath}", "Success");
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed to compile/save patient record:\n{ex.Message}", "Error");
            }
        }

        // ===================== Chat (single implementation; no duplicates) =====================

        // If designer binds to AIChat_button_Click, keep it and delegate.
        private async void AIChat_button_Click(object sender, EventArgs e) => await SendChatMessageAsync();

        // Your code wires this in constructor; keep it.
        private async void AIChat_button_Click_1(object? sender, EventArgs e) => await SendChatMessageAsync();

        private async void AIChat_textBox_KeyDown(object? sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Enter && !string.IsNullOrWhiteSpace(AIChat_textBox.Text))
            {
                e.SuppressKeyPress = true;
                await SendChatMessageAsync();
            }
        }

        private void AppendUserMessage(string message)
        {
            AIChat_richTextBox.SelectionColor = Color.Black;
            AIChat_richTextBox.AppendText($"User: {message}\n\n");
            AIChat_richTextBox.SelectionStart = AIChat_richTextBox.Text.Length;
            AIChat_richTextBox.ScrollToCaret();
        }

        private void AppendAIMessage(string message)
        {
            AIChat_richTextBox.SelectionColor = Color.DarkBlue;
            AIChat_richTextBox.AppendText($"AI: {message}\n\n");
            AIChat_richTextBox.SelectionStart = AIChat_richTextBox.Text.Length;
            AIChat_richTextBox.ScrollToCaret();
        }

        private async Task SendChatMessageAsync()
        {
            string userInput = AIChat_textBox.Text.Trim();
            if (string.IsNullOrEmpty(userInput)) return;

            chatHistory.Add(new ChatMessage("user", userInput));
            if (chatHistory.Count > 50) chatHistory.RemoveRange(0, chatHistory.Count - 50);

            AppendUserMessage(userInput);
            AIChat_textBox.Clear();

            try
            {
                var history = chatHistory.Select(m => new { role = m.Role, content = m.Content }).ToList();
                var response = await Http.PostAsJsonAsync($"{BackendBaseUrl}/chat", new { history });
                response.EnsureSuccessStatusCode();

                var result = await response.Content.ReadFromJsonAsync<Dictionary<string, string>>();
                string aiReply = result != null && result.TryGetValue("reply", out var reply) ? reply : "No response from AI.";

                chatHistory.Add(new ChatMessage("assistant", aiReply));
                AppendAIMessage(aiReply);
            }
            catch (Exception ex)
            {
                AIChat_richTextBox.SelectionColor = Color.Red;
                AIChat_richTextBox.AppendText($"[ERROR]: {ex.Message}\n\n");
            }
        }

        private void MedicalDoctorForm_Load(object? sender, EventArgs e)
        {
            AIChat_richTextBox.Clear();
            AIChat_textBox.Clear();
            AIChat_richTextBox.SelectionColor = Color.Black;
            AIChat_richTextBox.AppendText(
                "CoPilot Symptomatologist Chatbot v1.0 created by Evans Sansolis. " +
                "Type your question and press Enter or click Send.\n\n");
        }

        // ===================== Vosk Voice Over =====================

        private void VoiceOverON_button_Click_1(object sender, EventArgs e)
        {
            StartVoskRecognition();
            VoiceOverOFF_button.Visible = true;
            VoiceOverON_button.Visible = false;
        }

        private void VoiceOverOFF_button_Click_1(object sender, EventArgs e)
        {
            StopVoskRecognition();
            VoiceOverOFF_button.Visible = false;
            VoiceOverON_button.Visible = true;
        }

        private void StartVoskRecognition()
        {
            if (_voskListening) return;

            string modelPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "backend", "vosk-model-small-en-us-0.15");
            if (!Directory.Exists(modelPath))
            {
                MessageBox.Show($"Vosk model folder not found:\n{modelPath}", "Vosk Error");
                return;
            }

            try
            {
                _voskModel ??= new Model(modelPath);
                _recognizer = new VoskRecognizer(_voskModel, 16000.0f);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed to initialize Vosk model or recognizer:\n{ex.Message}", "Vosk Error");
                return;
            }

            try
            {
                _waveIn = new WaveInEvent
                {
                    DeviceNumber = 0,
                    WaveFormat = new WaveFormat(16000, 1)
                };

                _waveIn.DataAvailable += (s, a) =>
                {
                    if (_recognizer == null) return;

                    string json = _recognizer.AcceptWaveform(a.Buffer, a.BytesRecorded)
                        ? _recognizer.Result()
                        : _recognizer.PartialResult();

                    string text = ParseText(json);
                    if (!string.IsNullOrWhiteSpace(text))
                    {
                        try
                        {
                            BeginInvoke(new Action(() =>
                                DoctorsNote_richTextBox.AppendText(text)));
                        }
                        catch { }
                    }
                };

                _waveIn.StartRecording();
                _voskListening = true;
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed to start audio input:\n{ex.Message}", "Audio Error");
                _voskListening = false;
            }
        }

        private void StopVoskRecognition()
        {
            try { _waveIn?.StopRecording(); } catch { }
            try { _waveIn?.Dispose(); } catch { }
            _waveIn = null;

            try { _recognizer?.Dispose(); } catch { }
            _recognizer = null;

            _voskListening = false;
        }

        private static string ParseText(string jsonResult)
        {
            try
            {
                using var obj = JsonDocument.Parse(jsonResult);
                return obj.RootElement.TryGetProperty("text", out var textProp)
                    ? ((textProp.GetString() ?? string.Empty) + " ")
                    : string.Empty;
            }
            catch
            {
                return string.Empty;
            }
        }

        // ===================== Train AI =====================

        private sealed class TrainAiProgressDialog : Form
        {
            public ProgressBar Bar { get; }
            public Label Status { get; }

            public TrainAiProgressDialog()
            {
                Text = "Training AI — Building Local Knowledge Base";
                StartPosition = FormStartPosition.CenterParent;
                Width = 640;
                Height = 160;
                MinimizeBox = false;
                MaximizeBox = false;
                FormBorderStyle = FormBorderStyle.FixedDialog;

                Status = new Label
                {
                    Dock = DockStyle.Top,
                    Height = 48,
                    TextAlign = ContentAlignment.MiddleLeft,
                    Padding = new Padding(12),
                    Text = "Preparing…"
                };

                Bar = new ProgressBar
                {
                    Dock = DockStyle.Top,
                    Height = 28,
                    Style = ProgressBarStyle.Continuous,
                    Minimum = 0,
                    Maximum = 100,
                    Value = 0
                };

                Controls.Add(Bar);
                Controls.Add(Status);
            }

            public void SetStatus(string text, int percent)
            {
                Status.Text = text;
                if (percent < 0) percent = 0;
                if (percent > 100) percent = 100;
                Bar.Value = percent;
                Refresh();
            }
        }

        private static async Task<TrainStatusDto?> GetTrainStatusAsync()
        {
            try
            {
                return await Http.GetFromJsonAsync<TrainStatusDto>(
                    $"{BackendBaseUrl}/train_ai/status");
            }
            catch
            {
                return null;
            }
        }

        private static async Task UploadOneTrainingFileAsync(string path, string tagsCsv)
        {
            using var form = new MultipartFormDataContent();

            using var fs = File.OpenRead(path);
            var sc = new StreamContent(fs);
            sc.Headers.ContentType = path.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)
                ? new MediaTypeHeaderValue("application/pdf")
                : new MediaTypeHeaderValue("text/plain");

            form.Add(sc, "file", Path.GetFileName(path) ?? "upload");

            if (!string.IsNullOrWhiteSpace(tagsCsv))
                form.Add(new StringContent(tagsCsv), "tags");

            var resp = await Http.PostAsync($"{BackendBaseUrl}/train_ai/upload", form);
            resp.EnsureSuccessStatusCode();
        }

        private async void TrainAI_button_Click_1(object sender, EventArgs e)
        {
            await RunTrainAiFlowAsync();
        }

        // Some designers may still bind to this method name; keep it delegated.
        private async void TrainAI_button_Click(object sender, EventArgs e)
        {
            await RunTrainAiFlowAsync();
        }

        private async Task RunTrainAiFlowAsync()
        {
            using var ofd = new OpenFileDialog
            {
                Title = "Select Clinical References / Templates (PDF/TXT)",
                Filter =
                    "Supported|*.pdf;*.txt;*.md|" +
                    "PDF (*.pdf)|*.pdf|" +
                    "Text (*.txt;*.md)|*.txt;*.md|" +
                    "All files (*.*)|*.*",
                Multiselect = true
            };

            if (ofd.ShowDialog(this) != DialogResult.OK) return;

            var files = ofd.FileNames?.Where(f => !string.IsNullOrWhiteSpace(f)).ToArray() ?? [];
            if (files.Length == 0) return;

            string tags = Interaction.InputBox(
                "Optional: add comma-separated tags for these sources.\nExamples: Cardio, Endocrine, Pediatrics, NICE, Merck, Protocols, SOAP, Referral\n\nLeave blank to skip.",
                "Tag Sources (Optional)",
                "");

            tags = string.Join(",", (tags ?? "")
                .Split(CommaSeparator, StringSplitOptions.RemoveEmptyEntries)
                .Select(t => t.Trim())
                .Where(t => t.Length > 0));

            using var dlg = new TrainAiProgressDialog();
            dlg.Show(this);
            dlg.SetStatus("Starting training…", 0);

            UseWaitCursor = true;

            try
            {
                var before = await GetTrainStatusAsync();
                int beforeCount = before?.TrainedDocuments ?? 0;

                for (int i = 0; i < files.Length; i++)
                {
                    int pct = (int)Math.Round((i * 100.0) / Math.Max(1, files.Length));
                    dlg.SetStatus($"Uploading {i + 1}/{files.Length}: {Path.GetFileName(files[i])}", pct);

                    await UploadOneTrainingFileAsync(files[i], tags);
                }

                dlg.SetStatus("Finalizing index…", 95);

                var after = await GetTrainStatusAsync();
                int afterCount = after?.TrainedDocuments ?? beforeCount;

                dlg.SetStatus("Ready for retrieval.", 100);

                MessageBox.Show(
                    $"Training complete.\n\n" +
                    $"Trained on {afterCount} document(s).\n" +
                    $"(Previously: {beforeCount})\n\n" +
                    $"Status: Ready for retrieval.",
                    "Train AI",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"Train AI failed:\n{ex.Message}\n\n" +
                    $"Tip: Ensure backend is running at {BackendBaseUrl} and OPENAI_API_KEY is set.",
                    "Train AI Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
            finally
            {
                UseWaitCursor = false;
                try { dlg.Close(); } catch { }
            }
        }



        private static string? PromptForReferenceQuery(string initialValue = "")
        {
            using var form = new Form
            {
                Width = 520,
                Height = 170,
                Text = "Medical References Search",
                StartPosition = FormStartPosition.CenterParent,
                FormBorderStyle = FormBorderStyle.FixedDialog,
                MaximizeBox = false,
                MinimizeBox = false
            };

            var label = new Label
            {
                Text = "Enter keywords / condition / diagnosis to search:",
                Left = 20,
                Top = 15,
                AutoSize = true
            };

            var textBox = new TextBox
            {
                Left = 20,
                Top = 40,
                Width = 460,
                Text = initialValue ?? ""
            };

            var okButton = new Button
            {
                Text = "Search",
                Left = 380,
                Width = 100,
                Top = 80,
                DialogResult = DialogResult.OK
            };

            var cancelButton = new Button
            {
                Text = "Cancel",
                Left = 270,
                Width = 100,
                Top = 80,
                DialogResult = DialogResult.Cancel
            };

            form.Controls.Add(label);
            form.Controls.Add(textBox);
            form.Controls.Add(okButton);
            form.Controls.Add(cancelButton);

            form.AcceptButton = okButton;
            form.CancelButton = cancelButton;

            return form.ShowDialog() == DialogResult.OK
                ? textBox.Text.Trim()
                : null;
        }

        // ===================== Navigation buttons =====================

        private void MedicalReferences_button_Click_1(object sender, EventArgs e)
        {
            // Suggest initial query from Doctor's Note (optional)
            var note = DoctorsNote_richTextBox.Text ?? "";
            var firstLine = note.Replace("\r", "")
                                .Split('\n')
                                .FirstOrDefault(l => !string.IsNullOrWhiteSpace(l)) ?? "";

            var query = PromptForReferenceQuery(firstLine); // your popup helper
            if (string.IsNullOrWhiteSpace(query))
                return;

            using var referencesForm = new MedicalReferencesForm(query);
            referencesForm.ShowDialog(this);
        }



        private void ClearData_button_Click_1(object sender, EventArgs e)
        {
            // Optional: you can delegate to ClearData_button_Click for compatibility
            ClearData_button_Click(sender, e);
        }

        private void PatientRecords_button_Click_1(object sender, EventArgs e)
        {
            try
            {
                using var recordsForm = new MedicalRecordsViewForm();

                recordsForm.PdfFileSelected += path =>
                {
                    ShowPdfInPatientRecordPanel(path);

                    try
                    {
                        var snippet = ExtractPlainTextFromPdf(path, maxPages: 2, maxChars: 2000);
                        if (!string.IsNullOrWhiteSpace(snippet))
                        {
                            DoctorsNote_richTextBox.AppendText(
                                $"\n[Patient record excerpt: {Path.GetFileName(path)}]\n" +
                                $"{snippet.Trim()}\n");
                        }
                    }
                    catch (Exception ex2)
                    {
                        MessageBox.Show($"Could not extract text from patient record:\n{ex2.Message}", "PDF Error");
                    }
                };

                recordsForm.ShowDialog(this);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to access Medical Records:\n" + ex.Message, "Error");
            }
        }

        private void MedicalReferences_button_Click(object sender, EventArgs e)
        {
            MedicalReferences_button_Click_1(sender, e);
        }

        private void ClearData_button_Click(object sender, EventArgs e)
        {
            try
            {
                DoctorsNote_richTextBox?.Clear();
                AIAnalysis_richTextBox?.Clear();
                AIChat_richTextBox?.Clear();
                AIChat_textBox?.Clear();

                ResetProgressBar(DoctorsNote_progressBar);
                ResetProgressBar(AIAnalysis_progressBar);

                this.Tag = null;

                // If you are showing patient PDFs in the panel, dispose + clear properly
                DisposePatientPdf();

                MessageBox.Show(
                    "All fields have been cleared.",
                    "Cleared",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"Clear operation encountered an error, but the app will continue.\n\nDetails: {ex.Message}",
                    "Clear Warning",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning
                );
            }
        }

        private static void ResetProgressBar(ProgressBar? pb)
        {
            if (pb == null || pb.IsDisposed) return;

            try
            {
                pb.Visible = false;
                pb.Minimum = 0;
                pb.Maximum = 100;
                pb.Value = 0;
            }
            catch
            {
                // Non-fatal
            }
        }

        // ===================== Medication Lookup (RxNav) =====================

        private static async Task<List<string>> LookupMedicationReadableAsync(string drugName)
        {
            // Reuse the shared HttpClient, do NOT create per call
            string url = $"https://rxnav.nlm.nih.gov/REST/drugs.json?name={Uri.EscapeDataString(drugName)}";

            var response = await Http.GetAsync(url);
            response.EnsureSuccessStatusCode();

            string json = await response.Content.ReadAsStringAsync();
            JObject root = JObject.Parse(json);

            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            var props = root["drugGroup"]?["conceptGroup"]?
                .SelectMany(g => g?["conceptProperties"] ?? new JArray());

            if (props == null)
                return ["No results found."];

            foreach (var p in props)
            {
                string? name = p?["name"]?.ToString();
                if (string.IsNullOrWhiteSpace(name))
                    continue;

                // Filter OUT massive combination products unless explicitly needed
                if (name.Contains('/') && !name.StartsWith(drugName, StringComparison.OrdinalIgnoreCase))
                    continue;

                names.Add(name);
            }

            return [.. names
                .OrderBy(n => n)
                .Take(25)];
        }

        private async void MedicationLookup_button_Click(object sender, EventArgs e)
        {
            var drug = PromptForMedicationName();
            if (string.IsNullOrWhiteSpace(drug))
                return;

            try
            {
                var results = await LookupMedicationReadableAsync(drug);

                var sb = new StringBuilder();
                sb.AppendLine($"Medication: {drug}");
                sb.AppendLine("Common formulations:");
                sb.AppendLine();

                foreach (var r in results)
                    sb.AppendLine("• " + r);

                MessageBox.Show(
                    sb.ToString(),
                    "Medication Lookup",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"Medication lookup failed:\n{ex.Message}",
                    "Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        // ===================== ChatMessage Model =====================

        public class ChatMessage(string role, string content)
        {
            public string Role { get; } = role;
            public string Content { get; } = content;
        }

        private async void AnalyzePatientCase_button_Click(object sender, EventArgs e)
        {
            AIAnalysis_progressBar.Visible = true;
            AIAnalysis_progressBar.Style = ProgressBarStyle.Marquee;
            AIAnalysis_progressBar.MarqueeAnimationSpeed = 30;

            var clicked = sender as Control;
            bool restoreEnabled = false;
            if (clicked != null)
            {
                restoreEnabled = clicked.Enabled;
                clicked.Enabled = false;
            }

            UseWaitCursor = true;

            try
            {
                string note = DoctorsNote_richTextBox.Text.Trim();
                if (string.IsNullOrWhiteSpace(note))
                {
                    MessageBox.Show("Doctor's note is empty.", "Information", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                // 1) Pull evidence from PubMed (reliable medical literature)
                var pubmedLines = await SearchPubMedAsync(note, maxResults: 6);

                var evidenceBlock = pubmedLines.Count > 0
                    ? string.Join("\n", pubmedLines)
                    : "No PubMed matches found for the current note.";

                // 2) Ask ChatGPT (via your backend) to produce a clinician-style analysis
                //    (Uses your existing /chat endpoint contract: { history: [...] } -> { reply: "..." }
                var systemPrompt =
        @"You are an expert medical practitioner (clinician copilot).
Your job is to provide clinical guidance and patient education based ONLY on the information given.
Do NOT claim certainty. Do NOT invent tests, history, vitals, or diagnoses that are not provided.
If information is missing, list clarifying questions.

Output format (use headings):
1) Immediate Safety / Red Flags (when to seek urgent care)
2) Clinical Summary (what stands out)
3) Differential Diagnosis (ranked, with brief rationale)
4) Recommended Workup (tests, exam focus, monitoring)
5) Initial Management / Supportive Care (conservative + when to escalate)
6) Patient Education (plain language)
7) References (use provided PubMed items; do not fabricate citations)

Rules:
- You must include a short disclaimer: 'This is not a diagnosis and cannot replace a licensed clinician.'
- Prefer guideline-based reasoning. If uncertain, say so.
- Use the provided PubMed items as references; do not invent URLs or DOIs.";

                var userPrompt =
        $@"PATIENT NOTE (input):
{note}

RELIABLE REFERENCES (PubMed search results):
{evidenceBlock}

Task:
Use the patient note to provide clinician-style support and guidance.
When you cite, cite only from the provided PubMed items above.";

                var history = new[]
                {
            new { role = "system", content = systemPrompt },
            new { role = "user", content = userPrompt }
        };

                var resp = await Http.PostAsJsonAsync($"{BackendBaseUrl}/chat", new { history });
                resp.EnsureSuccessStatusCode();

                var json = await resp.Content.ReadFromJsonAsync<Dictionary<string, string>>();
                var reply = (json != null && json.TryGetValue("reply", out var r) && !string.IsNullOrWhiteSpace(r))
                    ? r.Trim()
                    : "No analysis returned.";

                // 3) Present results
                AIAnalysis_richTextBox.Clear();
                AIAnalysis_richTextBox.AppendText("===== Evidence (PubMed) =====\n");
                AIAnalysis_richTextBox.AppendText(evidenceBlock + "\n\n");
                AIAnalysis_richTextBox.AppendText("===== Clinical Guidance (AI) =====\n");
                AIAnalysis_richTextBox.AppendText(reply + "\n");
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Analyze failed:\n{ex.Message}", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                AIAnalysis_progressBar.MarqueeAnimationSpeed = 0;
                AIAnalysis_progressBar.Style = ProgressBarStyle.Blocks;
                AIAnalysis_progressBar.Visible = false;

                clicked?.Enabled = restoreEnabled;
                UseWaitCursor = false;
            }
        }

        private void CompilePatientRecord_button_Click(object sender, EventArgs e)
        {
            string note = DoctorsNote_richTextBox.Text?.Trim() ?? "";
            if (string.IsNullOrWhiteSpace(note))
            {
                MessageBox.Show("Doctor's note is empty.", "Info", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            // 1) Output directory
            string outDir = @"C:\SymptomatologistCopilot_Records\Doc_Patient_Report";
            Directory.CreateDirectory(outDir);

            // 2) Extract patient identity from the note (best-effort, regex-free)
            //    We look for common labels in the note. If not found, fallback.
            string fullName = TryExtractLabeledValue(note, "Full Name:");
            if (string.IsNullOrWhiteSpace(fullName))
                fullName = TryExtractLabeledValue(note, "Patient Name:");
            if (string.IsNullOrWhiteSpace(fullName))
                fullName = "patient_record";

            string dob = TryExtractLabeledValue(note, "Date of Birth:");
            if (string.IsNullOrWhiteSpace(dob))
                dob = TryExtractLabeledValue(note, "DOB:");

            // 3) Build timestamp
            string stamp = DateTime.Now.ToString("yyyyMMdd_HHmmss_fff");

            // 4) Build base filename like:
            //    "Maria Lourdes Reyes (March 14, 1978) 20260105_140439_823_DPR.pdf"
            string baseName;
            if (!string.IsNullOrWhiteSpace(dob))
                baseName = $"{fullName} ({dob}) {stamp}_DPR";
            else
                baseName = $"{fullName} {stamp}_DPR";

            // 5) Sanitize filename (NO REGEX)
            string safeFileName = SanitizeFileNameNoRegex(baseName) + ".pdf";
            string fullPath = Path.Combine(outDir, safeFileName);

            try
            {
                // 6) Write PDF via Microsoft Print to PDF (your existing helper)
                WritePdfFromText(note, fullPath);

                MessageBox.Show(
                    $"Doctor Patient Report saved:\n{fullPath}",
                    "Success",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );

                // Optional: open the folder
                // System.Diagnostics.Process.Start("explorer.exe", outDir);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"Failed to compile/save patient record:\n{ex.Message}",
                    "Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        /// <summary>
        /// Regex-free label extraction:
        /// Finds a line that starts with the given label, returns the text after it.
        /// Example line: "Full Name: Maria Lourdes Reyes"
        /// </summary>
        private static string TryExtractLabeledValue(string note, string label)
        {
            if (string.IsNullOrWhiteSpace(note) || string.IsNullOrWhiteSpace(label))
                return "";

            var lines = note.Replace("\r", "").Split('\n');

            for (int i = 0; i < lines.Length; i++)
            {
                string line = (lines[i] ?? "").Trim();
                if (line.Length == 0) continue;

                // Case-insensitive "starts with" match without Regex
                if (line.StartsWith(label, StringComparison.OrdinalIgnoreCase))
                {
                    string value = line[label.Length..].Trim();
                    return value;
                }
            }

            return "";
        }

        /// <summary>
        /// Regex-free filename sanitizer:
        /// - Removes invalid Windows filename characters
        /// - Collapses repeated spaces
        /// - Trims trailing dots/spaces (Windows disallows)
        /// </summary>
        private static string SanitizeFileNameNoRegex(string input)
        {
            if (string.IsNullOrWhiteSpace(input))
                return "patient_record";

            char[] invalid = Path.GetInvalidFileNameChars();
            var sb = new StringBuilder(input.Length);

            bool lastWasSpace = false;

            foreach (char ch in input)
            {
                // Replace invalid chars with underscore
                bool isInvalid = false;
                for (int i = 0; i < invalid.Length; i++)
                {
                    if (ch == invalid[i]) { isInvalid = true; break; }
                }

                char outCh = isInvalid ? '_' : ch;

                // Normalize whitespace (collapse)
                if (char.IsWhiteSpace(outCh))
                {
                    if (!lastWasSpace)
                    {
                        sb.Append(' ');
                        lastWasSpace = true;
                    }
                    continue;
                }

                lastWasSpace = false;
                sb.Append(outCh);
            }

            string result = sb.ToString().Trim();

            // Windows disallows filenames ending in '.' or ' '
            while (result.EndsWith('.') || result.EndsWith(' '))
                result = result[..^1];

            if (string.IsNullOrWhiteSpace(result))
                return "patient_record";

            return result;
        }

    }
}
