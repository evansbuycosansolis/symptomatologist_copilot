using System;
using System.Collections.Generic;
using System.Drawing;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace CoPilotSymptomatologistWinApp
{
	// Keep partial because Designer.cs exists
	public partial class MedicalReferencesForm : Form
	{
		private const string BackendBaseUrl = "http://localhost:8080";
		private static readonly TimeSpan HttpTimeout = TimeSpan.FromSeconds(90);
		private static readonly HttpClient Http = new() { Timeout = HttpTimeout };

		private readonly string _query;

		// Make them nullable to satisfy nullable analysis,
		// and guard access via null checks.
		private RichTextBox? _rtb;
		private Button? _btnCopy;
		private Button? _btnClose;
		private Label? _lblStatus;
		private ProgressBar? _progress;

		public MedicalReferencesForm(string query)
		{
			InitializeComponent();

			_query = (query ?? string.Empty).Trim();

			Text = "Medical References (PubMed + ClinicalTrials + RxNav)";
			StartPosition = FormStartPosition.CenterParent;
			Width = 980;
			Height = 760;
			MinimizeBox = false;
			MaximizeBox = true;

			BuildUi();

			Shown += async (s, e) => await LoadReferencesAsync();
		}

		private void BuildUi()
		{
			var topPanel = new Panel { Dock = DockStyle.Top, Height = 56 };

			_lblStatus = new Label
			{
				Dock = DockStyle.Fill,
				TextAlign = ContentAlignment.MiddleLeft,
				Padding = new Padding(12, 0, 0, 0),
				Text = "Ready."
			};

			_progress = new ProgressBar
			{
				Dock = DockStyle.Bottom,
				Height = 6,
				Style = ProgressBarStyle.Marquee,
				MarqueeAnimationSpeed = 25,
				Visible = false
			};

			_btnCopy = new Button
			{
				Text = "Copy All",
				Width = 110,
				Height = 30,
				Anchor = AnchorStyles.Top | AnchorStyles.Right,
				Top = 10,
				Enabled = false
			};
			_btnCopy.Click += (s, e) =>
			{
				if (_rtb == null) return;
				try
				{
					Clipboard.SetText(_rtb.Text);
					MessageBox.Show("Report copied to clipboard.", "Copied",
						MessageBoxButtons.OK, MessageBoxIcon.Information);
				}
				catch (Exception ex)
				{
					MessageBox.Show($"Copy failed:\n{ex.Message}", "Error",
						MessageBoxButtons.OK, MessageBoxIcon.Error);
				}
			};

			_btnClose = new Button
			{
				Text = "Close",
				Width = 110,
				Height = 30,
				Anchor = AnchorStyles.Top | AnchorStyles.Right,
				Top = 10,
				DialogResult = DialogResult.OK
			};

			// Keep right-aligned on resize
			topPanel.Resize += (s, e) =>
			{
				if (_btnClose == null || _btnCopy == null) return;
				_btnClose.Left = topPanel.ClientSize.Width - _btnClose.Width - 12;
				_btnCopy.Left = _btnClose.Left - _btnCopy.Width - 10;
			};

			topPanel.Controls.Add(_lblStatus);
			topPanel.Controls.Add(_btnCopy);
			topPanel.Controls.Add(_btnClose);
			topPanel.Controls.Add(_progress);

			_rtb = new RichTextBox
			{
				Dock = DockStyle.Fill,
				Font = new Font("Segoe UI", 10f),
				ReadOnly = true,
				WordWrap = true,
				DetectUrls = true
			};

			Controls.Clear();
			Controls.Add(_rtb);
			Controls.Add(topPanel);

			topPanel.PerformLayout();
			topPanel.Invalidate();
		}

		private void SetLoadingUi(bool isLoading, string message, string statusText)
		{
			_btnCopy?.Enabled = false;
            _progress?.Visible = isLoading;

			// "Changing 'field' might not have effect until restart" is a hot-reload/debugger message.
			// This is safe in normal runs.
			UseWaitCursor = isLoading;

			_lblStatus?.Text = statusText;

			if (_rtb != null && !string.IsNullOrWhiteSpace(message))
				_rtb.Text = message;
		}

		private async Task LoadReferencesAsync()
		{
			if (_rtb == null || _lblStatus == null || _btnCopy == null || _progress == null)
				return;

			var q = (_query ?? string.Empty).Trim();
			if (string.IsNullOrWhiteSpace(q))
			{
				_rtb.Text = "No input.";
				_lblStatus.Text = "No input.";
				_btnCopy.Enabled = false;
				return;
			}

			SetLoadingUi(
				isLoading: true,
				message:
					"Fetching medical references...\n\n" +
					"This may take a few seconds depending on network speed\n" +
					"and the number of articles retrieved.\n\n" +
					"Please wait…",
				statusText: "Fetching references…"
			);

			try
			{
				var payload = new
				{
					query = q,
					max_pubmed = 6,
					max_trials = 5,
					max_rxnorm = 15,
					summarize = true,
					max_summary_paragraphs = 3
				};

				var resp = await Http.PostAsJsonAsync($"{BackendBaseUrl}/medical_references", payload);
				resp.EnsureSuccessStatusCode();

				var json = await resp.Content.ReadFromJsonAsync<Dictionary<string, object>>();
				if (json == null)
				{
					_rtb.Text = "No response from server.";
					_lblStatus.Text = "No response.";
					return;
				}

				var sb = new StringBuilder();
				sb.AppendLine("MEDICAL REFERENCES REPORT");
				sb.AppendLine();
				sb.AppendLine($"Query: {q}");
				sb.AppendLine();

				if (json.TryGetValue("summary_text", out var summaryObj) && summaryObj != null)
				{
					var summary = (summaryObj.ToString() ?? "").Trim();
					if (!string.IsNullOrWhiteSpace(summary))
					{
						sb.AppendLine("AI EVIDENCE SUMMARY (2–3 paragraphs)");
						sb.AppendLine();
						sb.AppendLine(summary);
						sb.AppendLine();
						sb.AppendLine(new string('-', 70));
						sb.AppendLine();
					}
				}

				if (json.TryGetValue("report_text", out var reportObj) && reportObj != null)
				{
					var report = (reportObj.ToString() ?? "").Trim();
					if (!string.IsNullOrWhiteSpace(report))
						sb.AppendLine(report);
					else
						sb.AppendLine("Server returned an empty report_text.");
				}
				else
				{
					sb.AppendLine("Server response did not include report_text.");
				}

				_rtb.Text = sb.ToString();
				_lblStatus.Text = "Ready.";
			}
			catch (HttpRequestException ex)
			{
				_rtb.Text =
					"Unable to reach backend.\n\n" +
					$"Query: {q}\n\n" +
					$"Details: {ex.Message}\n\n" +
					$"Expected backend: {BackendBaseUrl}\nEndpoint: /medical_references";
				_lblStatus.Text = "Connection error.";
			}
			catch (TaskCanceledException)
			{
				_rtb.Text = "Request timed out. Please try again.";
				_lblStatus.Text = "Timeout.";
			}
			catch (Exception ex)
			{
				_rtb.Text =
					"Unable to fetch references.\n\n" +
					$"Query: {q}\n\n" +
					$"Error: {ex.Message}\n\n" +
					$"Expected backend: {BackendBaseUrl}\nEndpoint: /medical_references";
				_lblStatus.Text = "Error.";
			}
			finally
			{
				_progress.Visible = false;
				UseWaitCursor = false;
				_btnCopy.Enabled = !string.IsNullOrWhiteSpace(_rtb.Text);
			}
		}
	}
}
