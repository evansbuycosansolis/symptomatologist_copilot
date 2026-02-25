export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PatientIntakeData {
  FullName: string;
  DateOfBirth: string;
  Gender: string;
  Address: string;
  PhoneNumber: string;
  Email: string;
  ContactPerson: string;
  ContactNumber: string;
  BloodPressure: string;
  HeartRate: string;
  RespiratoryRate: string;
  Temperature: string;
  SpO2: string;
  Height: string;
  Weight: string;
  BMI: string;
  ChiefComplaint: string;
  OnsetDate: string;
  Duration: string;
  Severity: string;
  Location: string;
  AssociatedSymptoms: string;
  Medications: string;
  OTCMeds: string;
  Supplements: string;
  SmokingStatus: string;
  AlcoholUse: string;
  DrugUse: string;
  Allergies: string;
  NotableFamilyMedicalHistory: string;
  PastMedicalHistory: string;
  ImmunizationHistory: string;
  LastClinicVisitNotes: string;
  MedicalAssistantNotes: string;
  AdditionalDemographicsNotes: string;
  AdditionalVitalNotes: string;
  AdditionalHistoryNotes: string;
  AdditionalMedicationNotes: string;
  AdditionalSocialNotes: string;
  AdditionalAllergyNotes: string;
  AdditionalFamilyHistoryNotes: string;
  AdditionalPastMedicalNotes: string;
  AdditionalImmunizationNotes: string;
  AdditionalLastClinicVisitNotes: string;
  AdditionalMedicalAssistantNotes: string;
  LabExtractedText1: string;
  LabExtractedText2: string;
  LabExtractedText3: string;
  LabExtractedText4: string;
  LabExtractedText5: string;
  LabExtractedText6: string;
}

export interface IntakeListItem {
  id: string;
  full_name: string;
  date_of_birth: string;
  chief_complaint: string;
  created_at: string;
  folder: string;
}

export interface KbDocument {
  id: string;
  filename: string;
  tags: string[];
  added_at: string;
  stored_path?: string;
  text_path?: string;
}

export interface PatientRecordListItem {
  id: string;
  title: string;
  filename: string;
  created_at: string;
  path: string;
}

export const emptyIntake: PatientIntakeData = {
  FullName: "",
  DateOfBirth: "",
  Gender: "",
  Address: "",
  PhoneNumber: "",
  Email: "",
  ContactPerson: "",
  ContactNumber: "",
  BloodPressure: "",
  HeartRate: "",
  RespiratoryRate: "",
  Temperature: "",
  SpO2: "",
  Height: "",
  Weight: "",
  BMI: "",
  ChiefComplaint: "",
  OnsetDate: "",
  Duration: "",
  Severity: "",
  Location: "",
  AssociatedSymptoms: "",
  Medications: "",
  OTCMeds: "",
  Supplements: "",
  SmokingStatus: "",
  AlcoholUse: "",
  DrugUse: "",
  Allergies: "",
  NotableFamilyMedicalHistory: "",
  PastMedicalHistory: "",
  ImmunizationHistory: "",
  LastClinicVisitNotes: "",
  MedicalAssistantNotes: "",
  AdditionalDemographicsNotes: "",
  AdditionalVitalNotes: "",
  AdditionalHistoryNotes: "",
  AdditionalMedicationNotes: "",
  AdditionalSocialNotes: "",
  AdditionalAllergyNotes: "",
  AdditionalFamilyHistoryNotes: "",
  AdditionalPastMedicalNotes: "",
  AdditionalImmunizationNotes: "",
  AdditionalLastClinicVisitNotes: "",
  AdditionalMedicalAssistantNotes: "",
  LabExtractedText1: "",
  LabExtractedText2: "",
  LabExtractedText3: "",
  LabExtractedText4: "",
  LabExtractedText5: "",
  LabExtractedText6: "",
};
