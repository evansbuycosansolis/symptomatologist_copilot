using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Drawing;
using System.Linq;
using System.Runtime.Versioning;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace CoPilotSymptomatologistWinApp
{
    [SupportedOSPlatform("windows6.1")]
    public partial class MainForm : Form
    {
        public MainForm()
        {
            InitializeComponent();
        }

        private void MedicalAssistantPortal_btn_Click(object sender, EventArgs e)
        {
            MedicalAssistantForm maForm = new();
            maForm.Show();
        }

        private void MedicalDoctor_btn_Click(object sender, EventArgs e)
        {
             MedicalDoctorForm mdForm = new();
             mdForm.Show();
        }

        private void MainForm_Load(object sender, EventArgs e)
        {

        }
    }
}
