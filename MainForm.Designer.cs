namespace CoPilotSymptomatologistWinApp
{
    partial class MainForm
    {

        private System.ComponentModel.IContainer components = null;

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

        /// <summary>
        /// Required method for Designer support - do not modify
        /// the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            MedicalAssistantPortal_btn = new Button();
            MedicalDoctor_btn = new Button();
            SuspendLayout();
            // 
            // MedicalAssistantPortal_btn
            // 
            MedicalAssistantPortal_btn.BackColor = SystemColors.ActiveCaption;
            MedicalAssistantPortal_btn.Font = new Font("Segoe UI", 12F, FontStyle.Regular, GraphicsUnit.Point, 0);
            MedicalAssistantPortal_btn.Location = new Point(102, 72);
            MedicalAssistantPortal_btn.Name = "MedicalAssistantPortal_btn";
            MedicalAssistantPortal_btn.Size = new Size(352, 135);
            MedicalAssistantPortal_btn.TabIndex = 0;
            MedicalAssistantPortal_btn.Text = "Medical Assistant Portal";
            MedicalAssistantPortal_btn.UseVisualStyleBackColor = false;
            MedicalAssistantPortal_btn.Click += MedicalAssistantPortal_btn_Click;
            // 
            // MedicalDoctor_btn
            // 
            MedicalDoctor_btn.BackColor = SystemColors.ActiveCaption;
            MedicalDoctor_btn.Font = new Font("Segoe UI", 12F, FontStyle.Regular, GraphicsUnit.Point, 0);
            MedicalDoctor_btn.Location = new Point(102, 233);
            MedicalDoctor_btn.Name = "MedicalDoctor_btn";
            MedicalDoctor_btn.Size = new Size(352, 135);
            MedicalDoctor_btn.TabIndex = 1;
            MedicalDoctor_btn.Text = "Medical Doctor";
            MedicalDoctor_btn.UseVisualStyleBackColor = false;
            MedicalDoctor_btn.Click += MedicalDoctor_btn_Click;
            // 
            // MainForm
            // 
            AutoScaleDimensions = new SizeF(7F, 15F);
            AutoScaleMode = AutoScaleMode.Font;
            BackgroundImage = Properties.Resources.pngtree_vivid_abstract_texture_a_burst_of_colorful_background_picture_image_15292555;
            ClientSize = new Size(575, 453);
            Controls.Add(MedicalDoctor_btn);
            Controls.Add(MedicalAssistantPortal_btn);
            MaximizeBox = false;
            MinimizeBox = false;
            Name = "MainForm";
            Text = "Symptomatologist Copilot";
            Load += MainForm_Load;
            ResumeLayout(false);
        }

        #endregion

        private Button MedicalAssistantPortal_btn;
        private Button MedicalDoctor_btn;











    }










}