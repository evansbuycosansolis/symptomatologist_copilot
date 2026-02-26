import { PortalCard } from "@/components/ui";

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <h1>CoPilot Symptomatologist</h1>
        <p>
          Symptomatologist Copilot powered by Retrieval-Augmented Generation (RAG) GenAI.
          Use the Medical Assistant workspace for patient intake capture, then
          continue in the Doctor workspace for case analysis, chat, references,
          and local knowledge-base indexing.
        </p>
      </section>

      <section className="portal-grid">
        <PortalCard
          href="/assistant"
          title="Medical Assistant Portal"
          description="Structured patient intake, lab text capture, AI-enhanced intake summaries, and saved intake records."
          accent="#0c8f64"
        />
        <PortalCard
          href="/doctor"
          title="Medical Doctor Workspace"
          description="Doctor notes, attachments, AI chat, case analysis, medical references, KB training, and patient records."
          accent="#ef8c23"
        />
      </section>

      <p className="footer-note">
        Configure the frontend API target with <code>NEXT_PUBLIC_API_BASE_URL</code>.
      </p>
    </main>
  );
}
