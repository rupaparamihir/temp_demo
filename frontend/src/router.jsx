import { useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import App from "./App.jsx";
import { loadStoredAuth } from "./authStorage";

const DEMO_VIDEO_URL = "https://www.youtube.com/watch?v=9Aqnzjt-oyo&pp=ygUjdHVtIGphaXNlIGNodXRpeW8ga2Egc2FoYXJhIGthcmFva2U%3D";

function TeamMember({ name, role, detail, blurb }) {
  const [showFallback, setShowFallback] = useState(false);
  const memberKey = String(name || "").toLowerCase();
  let photo = "";
  if (memberKey.includes("sagar")) photo = "/team/Sagar Rami.jpeg";
  if (memberKey.includes("kejal")) photo = "/team/Kejal Doshi.jpeg";
  if (memberKey.includes("sushma")) photo = "/team/Sushma Yadav.jpeg";
  return (
    <article className="about-team-member">
      <div className="about-avatar" aria-hidden="true">
        {photo && !showFallback && (
          <img
            src={photo}
            alt=""
            loading="lazy"
            onError={() => setShowFallback(true)}
          />
        )}
        {(!photo || showFallback) && <span>{name.charAt(0)}</span>}
      </div>
      <div>
        <h4>{name}</h4>
        <p className="about-team-role">{role}</p>
        <p className="about-team-detail">{detail}</p>
        <p className="about-team-blurb">{blurb}</p>
      </div>
    </article>
  );
}

function LandingPage() {
  return (
    <main className="about-page">
      <header className="about-header">
        <Link to="/login" className="brand-logo brand-logo-wide" aria-label="Go to login">
          <span className="brand-mark">D</span>
          <div className="brand-copy">
            <strong>Digi Clinic</strong>
            <span>Clinic EMR Portal</span>
          </div>
        </Link>
      </header>

      <section className="about-surface">
        <div className="about-grid">
          <section className="about-main">
            <h1>About Digi Clinic</h1>
            <p className="about-subline">Clinically Designed | Secure | Made in India</p>
            <h2>Our Vision</h2>
            <p>
              At Digi Clinic, our mission is to simplify clinical practice through secure, affordable,
              and intelligent digital tools built specifically for healthcare professionals.
            </p>
            <p>
              We believe every clinic deserves access to reliable digital infrastructure without
              complexity or high costs.
            </p>

            <div className="about-points">
              <article className="about-point-item">
                <span className="about-point-icon" aria-hidden="true">📋</span>
                <div>
                <h3>Simplify Clinical Workflow</h3>
                <p>Reduce paper dependency and manual errors across patient registration, appointments, and follow-ups.</p>
                </div>
              </article>
              <article className="about-point-item">
                <span className="about-point-icon" aria-hidden="true">🛡️</span>
                <div>
                <h3>Build Trust Through Data Responsibility</h3>
                <p>Patient data is sensitive and sacred. Digi Clinic is designed with strong tenant isolation, consent-based data capture (aligned with India's DPDP Act 2023), and secure infrastructure to ensure privacy and compliance.</p>
                </div>
              </article>
              <article className="about-point-item">
                <span className="about-point-icon" aria-hidden="true">🇮🇳</span>
                <div>
                <h3>Enable Digital India in Healthcare</h3>
                <p>We support India's Digital India mission by empowering small and mid-sized clinics with affordable SaaS infrastructure, helping them transition confidently into digital healthcare ecosystems.</p>
                </div>
              </article>
            </div>
          </section>

          <aside className="about-team">
            <h2>Founding Team</h2>
            <TeamMember
              name="Dr. Sagar Rami"
              role="Founder & CEO"
              detail="Family Physician"
              blurb="Bringing real-world clinic experience to practical digital product design."
            />
            <TeamMember
              name="Kejal Doshi"
              role="Founder & Managing Director"
              detail="Master's in Pharmacy"
              blurb="Focused on standards, operational excellence, and scalable healthcare platforms."
            />
            <TeamMember
              name="Dr. Sushma Yadav"
              role="Vice President (Clinical Strategy)"
              detail="Family Physician"
              blurb="Guiding usability, clinical workflows, and patient-first feature development."
            />

            <div className="about-contact-row">
              <span className="about-contact-item">
                <span className="about-contact-icon" aria-hidden="true">{"\u2709"}</span>
                support@digiclinic.in
              </span>
              <span className="about-contact-item">
                <span className="about-contact-icon about-contact-icon-phone" aria-hidden="true">{"\u2706"}</span>
                +91-99765 43210
              </span>
            </div>
            <nav className="about-inline-links">
              <Link to="/login">Login</Link>
              <Link to="/demo">Demo</Link>
            </nav>
          </aside>
        </div>
      </section>
    </main>
  );
}

function DemoCard({ step, title, caption, description }) {
  return (
    <article className="demo-card">
      <p className="demo-step">{step}</p>
      <p className="demo-description">{description}</p>
      <a href={DEMO_VIDEO_URL} target="_blank" rel="noreferrer" className="demo-thumb-link" aria-label={`Open ${title} demo video`}>
        <div className="demo-thumb">
          <div className="demo-ui-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span className="demo-play" aria-hidden="true">{"\u25b6"}</span>
        </div>
      </a>
      <a href={DEMO_VIDEO_URL} target="_blank" rel="noreferrer" className="demo-watch-link">Watch Demo</a>
    </article>
  );
}

function DemoPage() {
  return (
    <main className="page demo-page">
      <section className="demo-head">
        <Link to="/login" className="brand-logo brand-logo-wide" aria-label="Go to login">
          <span className="brand-mark">D</span>
          <div className="brand-copy">
            <strong>Digi Clinic</strong>
            <span>Clinic EMR Portal</span>
          </div>
        </Link>
        <nav className="about-inline-links">
          <Link to="/login">Login</Link>
          <Link to="/about">About Us</Link>
        </nav>
      </section>

      <section className="demo-intro">
        <p className="demo-kicker">Product Walkthrough</p>
        <p>Watch quick videos for registration, appointment handling, and patient history workflows.</p>
      </section>

      <section className="demo-grid">
        <DemoCard
          step="1. Patient Registration"
          title="Patient Registration"
          caption="Digi Clinic Demo"
          description="Quickly register new patients with details, age, and consent capture."
        />
        <DemoCard
          step="2. Add Appointment"
          title="Add Appointment"
          caption="Digi Clinic Demo"
          description="Add and update follow-up appointments easily and efficiently."
        />
        <DemoCard
          step="3. View History & Summary"
          title="View History & Summary"
          caption="Digi Clinic Demo"
          description="Access complete patient history, reports, and follow-ups."
        />
      </section>
    </main>
  );
}

function ContactPage() {
  return (
    <main className="page">
      <section className="auth-surface">
        <div className="auth-grid">
          <aside className="auth-marketing">
            <Link to="/login" className="brand-logo brand-logo-wide" aria-label="Go to login">
              <span className="brand-mark">D</span>
              <div className="brand-copy">
                <strong>Digi Clinic</strong>
                <span>Clinic EMR Portal</span>
              </div>
            </Link>
            <h2>Stay connected with Digi Clinic.</h2>
            <p>For onboarding, support, or product queries, reach us anytime.</p>
            <div className="auth-feature-list">
              <p><span>{"\u2713"}</span> Fast Response</p>
              <p><span>{"\u2713"}</span> India Support</p>
              <p><span>{"\u2713"}</span> Clinic Onboarding</p>
              <p><span>{"\u2713"}</span> Product Help</p>
            </div>
          </aside>

          <section className="auth-panel">
            <h3>Contact</h3>
            <p className="auth-panel-subtitle">We typically respond within 1 hour.</p>
            <section className="contact-card">
              <div className="contact-row">
                <span className="contact-icon" aria-hidden="true">{"\u2302"}</span>
                <p>Address: Bhayander, Thane: 401101, Maharashtra, India</p>
              </div>
              <div className="contact-row">
                <span className="contact-icon" aria-hidden="true">{"\u2709"}</span>
                <p>Email: support@digiclinic.in</p>
              </div>
              <div className="contact-row">
                <span className="contact-icon contact-icon-phone" aria-hidden="true">{"\u2706"}</span>
                <p>Phone: +91-99765 43210</p>
              </div>
            </section>
            <nav className="auth-inline-nav" aria-label="Quick links">
              <Link className="auth-inline-link" to="/login">Login</Link>
              <Link className="auth-inline-link" to="/about">About Us</Link>
            </nav>
          </section>
        </div>
      </section>
    </main>
  );
}

export default function AppRouter() {
  const hasStoredSession = Boolean(loadStoredAuth()?.token);
  return (
    <div className="site-shell">
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/about" element={<LandingPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route
          path="/login"
          element={<App initialAuthMode="login" redirectAuthedToApp />}
        />
        <Route
          path="/app/*"
          element={
            hasStoredSession
              ? <App initialAuthMode="login" redirectUnauthedToLogin />
              : <Navigate to="/login" replace />
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      <footer className="site-copyright">{"\u00A9 2026 Digi Clinic. All rights reserved."}</footer>
    </div>
  );
}
