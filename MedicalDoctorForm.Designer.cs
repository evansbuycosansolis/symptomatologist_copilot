namespace CoPilotSymptomatologistWinApp
{
    partial class MedicalDoctorForm
    {
        /// <summary>
        /// Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        /// Clean up any resources being used.
        /// </summary>
        /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Windows Form Designer generated code
        private void InitializeComponent()
        {
            PatientRecord_label = new Label();
            AiAnalysis_label = new Label();
            DoctorNote_label = new Label();
            Ai_chatlabel = new Label();
            PatientRecord_panel = new Panel();
            DoctorsNote_richTextBox = new RichTextBox();
            DoctorsNote_progressBar = new ProgressBar();
            AIAnalysis_richTextBox = new RichTextBox();
            AIAnalysis_progressBar = new ProgressBar();
            AIChat_richTextBox = new RichTextBox();
            AIChat_textBox = new TextBox();
            AIChat_button = new Button();
            AttachFile_button = new Button();
            AnalyzePatientCase_button = new Button();
            ReviseMedicalReport_button = new Button();
            CompilePatientRecord_button = new Button();
            ClearData_button = new Button();
            TrainAI_button = new Button();
            MedicationLookup_button = new Button();
            PatientRecords_button = new Button();
            MedicalReferences_button = new Button();
            VoiceOverON_button = new Button();
            VoiceOverOFF_button = new Button();
            SuspendLayout();
            // 
            // PatientRecord_label
            // 
            PatientRecord_label.AutoSize = true;
            PatientRecord_label.Location = new Point(46, 35);
            PatientRecord_label.Name = "PatientRecord_label";
            PatientRecord_label.Size = new Size(87, 15);
            PatientRecord_label.TabIndex = 91;
            PatientRecord_label.Text = "Patient Record:";
            // 
            // AiAnalysis_label
            // 
            AiAnalysis_label.AutoSize = true;
            AiAnalysis_label.Location = new Point(577, 347);
            AiAnalysis_label.Name = "AiAnalysis_label";
            AiAnalysis_label.Size = new Size(67, 15);
            AiAnalysis_label.TabIndex = 90;
            AiAnalysis_label.Text = "AI Analysis:";
            // 
            // DoctorNote_label
            // 
            DoctorNote_label.AutoSize = true;
            DoctorNote_label.Location = new Point(578, 39);
            DoctorNote_label.Name = "DoctorNote_label";
            DoctorNote_label.Size = new Size(83, 15);
            DoctorNote_label.TabIndex = 89;
            DoctorNote_label.Text = "Doctor's Note:";
            // 
            // Ai_chatlabel
            // 
            Ai_chatlabel.AutoSize = true;
            Ai_chatlabel.Location = new Point(579, 564);
            Ai_chatlabel.Name = "Ai_chatlabel";
            Ai_chatlabel.Size = new Size(93, 15);
            Ai_chatlabel.TabIndex = 88;
            Ai_chatlabel.Text = "Copilot Chatbox";
            // 
            // PatientRecord_panel
            // 
            PatientRecord_panel.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left;
            PatientRecord_panel.BackColor = SystemColors.ButtonHighlight;
            PatientRecord_panel.BorderStyle = BorderStyle.FixedSingle;
            PatientRecord_panel.Location = new Point(46, 57);
            PatientRecord_panel.Name = "PatientRecord_panel";
            PatientRecord_panel.Size = new Size(515, 813);
            PatientRecord_panel.TabIndex = 69;
            // 
            // DoctorsNote_richTextBox
            // 
            DoctorsNote_richTextBox.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            DoctorsNote_richTextBox.BorderStyle = BorderStyle.FixedSingle;
            DoctorsNote_richTextBox.Location = new Point(578, 57);
            DoctorsNote_richTextBox.Name = "DoctorsNote_richTextBox";
            DoctorsNote_richTextBox.Size = new Size(925, 230);
            DoctorsNote_richTextBox.TabIndex = 70;
            DoctorsNote_richTextBox.Text = "";
            // 
            // DoctorsNote_progressBar
            // 
            DoctorsNote_progressBar.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            DoctorsNote_progressBar.Location = new Point(578, 291);
            DoctorsNote_progressBar.Name = "DoctorsNote_progressBar";
            DoctorsNote_progressBar.Size = new Size(925, 12);
            DoctorsNote_progressBar.TabIndex = 71;
            DoctorsNote_progressBar.Visible = false;
            // 
            // AIAnalysis_richTextBox
            // 
            AIAnalysis_richTextBox.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            AIAnalysis_richTextBox.BackColor = SystemColors.InactiveCaption;
            AIAnalysis_richTextBox.BorderStyle = BorderStyle.FixedSingle;
            AIAnalysis_richTextBox.Location = new Point(577, 365);
            AIAnalysis_richTextBox.Name = "AIAnalysis_richTextBox";
            AIAnalysis_richTextBox.Size = new Size(928, 170);
            AIAnalysis_richTextBox.TabIndex = 72;
            AIAnalysis_richTextBox.Text = "";
            // 
            // AIAnalysis_progressBar
            // 
            AIAnalysis_progressBar.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            AIAnalysis_progressBar.Location = new Point(578, 539);
            AIAnalysis_progressBar.Name = "AIAnalysis_progressBar";
            AIAnalysis_progressBar.Size = new Size(927, 10);
            AIAnalysis_progressBar.TabIndex = 73;
            AIAnalysis_progressBar.Visible = false;
            // 
            // AIChat_richTextBox
            // 
            AIChat_richTextBox.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            AIChat_richTextBox.BorderStyle = BorderStyle.FixedSingle;
            AIChat_richTextBox.Location = new Point(578, 582);
            AIChat_richTextBox.Name = "AIChat_richTextBox";
            AIChat_richTextBox.Size = new Size(926, 234);
            AIChat_richTextBox.TabIndex = 74;
            AIChat_richTextBox.Text = "";
            // 
            // AIChat_textBox
            // 
            AIChat_textBox.Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            AIChat_textBox.BorderStyle = BorderStyle.FixedSingle;
            AIChat_textBox.Location = new Point(577, 822);
            AIChat_textBox.Multiline = true;
            AIChat_textBox.Name = "AIChat_textBox";
            AIChat_textBox.Size = new Size(822, 48);
            AIChat_textBox.TabIndex = 75;
            // 
            // AIChat_button
            // 
            AIChat_button.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
            AIChat_button.BackColor = SystemColors.ControlDark;
            AIChat_button.Location = new Point(1405, 822);
            AIChat_button.Name = "AIChat_button";
            AIChat_button.Size = new Size(98, 48);
            AIChat_button.TabIndex = 76;
            AIChat_button.Text = "Send";
            AIChat_button.UseVisualStyleBackColor = false;
            AIChat_button.Click += AIChat_button_Click;
            // 
            // AttachFile_button
            // 
            AttachFile_button.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            AttachFile_button.BackColor = SystemColors.ControlDark;
            AttachFile_button.Location = new Point(579, 309);
            AttachFile_button.Name = "AttachFile_button";
            AttachFile_button.Size = new Size(126, 28);
            AttachFile_button.TabIndex = 77;
            AttachFile_button.Text = "Attach File";
            AttachFile_button.UseVisualStyleBackColor = false;
            AttachFile_button.Click += AttachFile_button_Click_1;
            // 
            // AnalyzePatientCase_button
            // 
            AnalyzePatientCase_button.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            AnalyzePatientCase_button.BackColor = SystemColors.ControlDark;
            AnalyzePatientCase_button.Location = new Point(1106, 309);
            AnalyzePatientCase_button.Name = "AnalyzePatientCase_button";
            AnalyzePatientCase_button.Size = new Size(126, 28);
            AnalyzePatientCase_button.TabIndex = 78;
            AnalyzePatientCase_button.Text = "Analyze Case";
            AnalyzePatientCase_button.UseVisualStyleBackColor = false;
            AnalyzePatientCase_button.Click += AnalyzePatientCase_button_Click;
            // 
            // ReviseMedicalReport_button
            // 
            ReviseMedicalReport_button.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            ReviseMedicalReport_button.BackColor = SystemColors.ControlDark;
            ReviseMedicalReport_button.Location = new Point(710, 309);
            ReviseMedicalReport_button.Name = "ReviseMedicalReport_button";
            ReviseMedicalReport_button.Size = new Size(126, 28);
            ReviseMedicalReport_button.TabIndex = 79;
            ReviseMedicalReport_button.Text = "Revise Report";
            ReviseMedicalReport_button.UseVisualStyleBackColor = false;
            ReviseMedicalReport_button.Click += ReviseMedicalReport_button_Click_1;
            // 
            // CompilePatientRecord_button
            // 
            CompilePatientRecord_button.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            CompilePatientRecord_button.BackColor = SystemColors.ControlDark;
            CompilePatientRecord_button.Location = new Point(1279, 882);
            CompilePatientRecord_button.Name = "CompilePatientRecord_button";
            CompilePatientRecord_button.Size = new Size(225, 47);
            CompilePatientRecord_button.TabIndex = 80;
            CompilePatientRecord_button.Text = "Compile as Report";
            CompilePatientRecord_button.UseVisualStyleBackColor = false;
            CompilePatientRecord_button.Click += CompilePatientRecord_button_Click;
            // 
            // ClearData_button
            // 
            ClearData_button.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            ClearData_button.BackColor = SystemColors.ControlDark;
            ClearData_button.Location = new Point(1049, 882);
            ClearData_button.Name = "ClearData_button";
            ClearData_button.Size = new Size(224, 47);
            ClearData_button.TabIndex = 81;
            ClearData_button.Text = "Clear";
            ClearData_button.UseVisualStyleBackColor = false;
            ClearData_button.Click += ClearData_button_Click;
            // 
            // TrainAI_button
            // 
            TrainAI_button.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            TrainAI_button.BackColor = SystemColors.ControlDark;
            TrainAI_button.Location = new Point(1363, 309);
            TrainAI_button.Name = "TrainAI_button";
            TrainAI_button.Size = new Size(126, 28);
            TrainAI_button.TabIndex = 82;
            TrainAI_button.Text = "Train AI";
            TrainAI_button.UseVisualStyleBackColor = false;
            TrainAI_button.Click += TrainAI_button_Click;
            // 
            // MedicationLookup_button
            // 
            MedicationLookup_button.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            MedicationLookup_button.BackColor = SystemColors.ControlDark;
            MedicationLookup_button.Location = new Point(842, 309);
            MedicationLookup_button.Name = "MedicationLookup_button";
            MedicationLookup_button.Size = new Size(126, 28);
            MedicationLookup_button.TabIndex = 83;
            MedicationLookup_button.Text = "Medication Lookup";
            MedicationLookup_button.UseVisualStyleBackColor = false;
            MedicationLookup_button.Click += MedicationLookup_button_Click;
            // 
            // PatientRecords_button
            // 
            PatientRecords_button.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            PatientRecords_button.BackColor = SystemColors.ControlDark;
            PatientRecords_button.Location = new Point(46, 876);
            PatientRecords_button.Name = "PatientRecords_button";
            PatientRecords_button.Size = new Size(126, 59);
            PatientRecords_button.TabIndex = 84;
            PatientRecords_button.Text = "Retrieve Patient Record";
            PatientRecords_button.UseVisualStyleBackColor = false;
            PatientRecords_button.Click += PatientRecords_button_Click_1;
            // 
            // MedicalReferences_button
            // 
            MedicalReferences_button.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            MedicalReferences_button.BackColor = SystemColors.ControlDark;
            MedicalReferences_button.Location = new Point(974, 309);
            MedicalReferences_button.Name = "MedicalReferences_button";
            MedicalReferences_button.Size = new Size(126, 28);
            MedicalReferences_button.TabIndex = 85;
            MedicalReferences_button.Text = "Medical References";
            MedicalReferences_button.UseVisualStyleBackColor = false;
            MedicalReferences_button.Click += MedicalReferences_button_Click;
            // 
            // VoiceOverON_button
            // 
            VoiceOverON_button.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            VoiceOverON_button.BackColor = SystemColors.ControlDark;
            VoiceOverON_button.Location = new Point(1400, 12);
            VoiceOverON_button.Name = "VoiceOverON_button";
            VoiceOverON_button.Size = new Size(110, 39);
            VoiceOverON_button.TabIndex = 86;
            VoiceOverON_button.Text = "Voice ON";
            VoiceOverON_button.UseVisualStyleBackColor = false;
            // 
            // VoiceOverOFF_button
            // 
            VoiceOverOFF_button.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            VoiceOverOFF_button.BackColor = SystemColors.ControlDark;
            VoiceOverOFF_button.Location = new Point(1400, 11);
            VoiceOverOFF_button.Name = "VoiceOverOFF_button";
            VoiceOverOFF_button.Size = new Size(110, 39);
            VoiceOverOFF_button.TabIndex = 87;
            VoiceOverOFF_button.Text = "Voice OFF";
            VoiceOverOFF_button.UseVisualStyleBackColor = false;
            VoiceOverOFF_button.Visible = false;
            // 
            // MedicalDoctorForm
            // 
            AutoScaleDimensions = new SizeF(7F, 15F);
            AutoScaleMode = AutoScaleMode.Font;
            BackColor = Color.LightBlue;
            BackgroundImage = Properties.Resources.pngtree_vivid_abstract_texture_a_burst_of_colorful_background_picture_image_15292555;
            BackgroundImageLayout = ImageLayout.Stretch;
            ClientSize = new Size(1550, 1033);
            Controls.Add(PatientRecord_label);
            Controls.Add(AiAnalysis_label);
            Controls.Add(DoctorNote_label);
            Controls.Add(Ai_chatlabel);
            Controls.Add(PatientRecord_panel);
            Controls.Add(DoctorsNote_richTextBox);
            Controls.Add(DoctorsNote_progressBar);
            Controls.Add(AIAnalysis_richTextBox);
            Controls.Add(AIAnalysis_progressBar);
            Controls.Add(AIChat_richTextBox);
            Controls.Add(AIChat_textBox);
            Controls.Add(AIChat_button);
            Controls.Add(AttachFile_button);
            Controls.Add(AnalyzePatientCase_button);
            Controls.Add(ReviseMedicalReport_button);
            Controls.Add(CompilePatientRecord_button);
            Controls.Add(ClearData_button);
            Controls.Add(TrainAI_button);
            Controls.Add(MedicationLookup_button);
            Controls.Add(PatientRecords_button);
            Controls.Add(MedicalReferences_button);
            Controls.Add(VoiceOverON_button);
            Controls.Add(VoiceOverOFF_button);
            Font = new Font("Segoe UI", 9F);
            MinimumSize = new Size(1000, 640);
            Name = "MedicalDoctorForm";
            StartPosition = FormStartPosition.CenterScreen;
            Text = "CoPilot Symptomatologist";
            ResumeLayout(false);
            PerformLayout();

        }

        #endregion

        private Label PatientRecord_label;
        private Label AiAnalysis_label;
        private Label DoctorNote_label;
        private Label Ai_chatlabel;
        private Panel PatientRecord_panel;
        private RichTextBox DoctorsNote_richTextBox;
        private ProgressBar DoctorsNote_progressBar;
        private RichTextBox AIAnalysis_richTextBox;
        private ProgressBar AIAnalysis_progressBar;
        private RichTextBox AIChat_richTextBox;
        private TextBox AIChat_textBox;
        private Button AIChat_button;
        private Button AttachFile_button;
        private Button AnalyzePatientCase_button;
        private Button ReviseMedicalReport_button;
        private Button CompilePatientRecord_button;
        private Button ClearData_button;
        private Button TrainAI_button;
        private Button MedicationLookup_button;
        private Button PatientRecords_button;
        private Button MedicalReferences_button;
        private Button VoiceOverON_button;
        private Button VoiceOverOFF_button;
    }
}