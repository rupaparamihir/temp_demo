import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  addPatient,
  addPatientAppointment,
  getCurrentSession,
  getMonthlyPatientsSummary,
  getNonRepeatPatientsSummary,
  getPatientAppointments,
  getWeeklyPatientsSummary,
  login,
  logoutSession,
  pingSession,
  resetPassword,
  registerClinic,
  searchPatients,
  updateLatestPatientAppointment
} from "./api";
import { clearStoredAuth, loadStoredAuth, storeAuth } from "./authStorage";

const HEARTBEAT_INTERVAL_MS = Math.max(60000, Number(import.meta.env.VITE_HEARTBEAT_INTERVAL_MS) || 300000);
const HEARTBEAT_JITTER_MS = Math.max(0, Number(import.meta.env.VITE_HEARTBEAT_JITTER_MS) || 20000);

const emptyPatient = () => ({ firstName: "", lastName: "", phone: "", birthYear: "", gender: "", notes: "", consentGiven: true });
const emptyAppointment = () => ({
  bpSystolic: "",
  bpDiastolic: "",
  pulse: "",
  oxygenLevel: "",
  sugar: "",
  thyroid: "",
  weight: "",
  temperature: "",
  pastHistoryCondition: ["NO"],
  pastHistory: "",
  paymentAmount: "",
  notes: "",
  reports: []
});
const emptyRegister = () => ({ doctorFullName: "", doctorQualification: "", doctorGender: "", clinicName: "", clinicAddress: "", clinicPincode: "", clinicCity: "", clinicState: "", clinicContactNumber: "", clinicEmailId: "", loginPassword: "", key: "", consentGiven: false });

function normalizeNameInput(value) {
  return value.toUpperCase().replace(/[^A-Z\s]/g, "").slice(0, 30);
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

function formatAmount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function formatPhoneCompact(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length !== 10) return phone || "-";
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

function calculateAgeFromBirthYear(birthYear) {
  const year = Number(String(birthYear || "").trim());
  if (!Number.isInteger(year)) return null;
  const currentYear = new Date().getFullYear();
  if (year < 1900 || year > currentYear) return null;
  return Math.max(1, currentYear - year);
}

function formatPatientAgeDisplay(patient) {
  const ageYearsRaw = Number(patient?.ageYears);
  if (Number.isInteger(ageYearsRaw) && ageYearsRaw > 0) {
    return `${ageYearsRaw} year`;
  }

  const ageText = String(patient?.age || "").trim();
  if (ageText) {
    const ageMatch = ageText.match(/\d+/);
    if (ageMatch) {
      const ageValue = Number(ageMatch[0]);
      if (Number.isInteger(ageValue) && ageValue > 0) return `${ageValue} year`;
    }
  }

  const birthYear = String(patient?.birthYear || "").trim();
  const calculated = calculateAgeFromBirthYear(birthYear);
  if (calculated === null) return "-";
  return `${calculated} year`;
}

function normalizeHistoryText(value) {
  const items = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "" && item.toUpperCase() !== "NO");
  return items.join(", ");
}

function parseBpForForm(appointment) {
  const systolic = appointment?.bpSystolic;
  const diastolic = appointment?.bpDiastolic;
  if (Number.isInteger(systolic) && Number.isInteger(diastolic)) {
    return { bpSystolic: String(systolic), bpDiastolic: String(diastolic) };
  }

  const legacy = String(appointment?.bp || "").trim();
  const match = legacy.match(/^(\d{1,3})\s*\/\s*(\d{1,3})$/);
  if (match) {
    return { bpSystolic: match[1], bpDiastolic: match[2] };
  }
  return { bpSystolic: "", bpDiastolic: "" };
}

function formatBpDisplay(appointment) {
  if (Number.isInteger(appointment?.bpSystolic) && Number.isInteger(appointment?.bpDiastolic)) {
    return `${appointment.bpSystolic}/${appointment.bpDiastolic}`;
  }
  const legacy = String(appointment?.bp || "").trim();
  return legacy;
}

function getHistorySelection(value) {
  const values = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.toUpperCase() !== "NO");
  return values.length > 0 ? values : ["NO"];
}

const MIN_APPOINTMENT_FIELDS = 2;

function parseAppointmentTime(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseAppointmentId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareAppointmentsDesc(a, b) {
  const timeDiff = parseAppointmentTime(b?.visitAt) - parseAppointmentTime(a?.visitAt);
  if (timeDiff !== 0) return timeDiff;

  const bId = parseAppointmentId(b?.id);
  const aId = parseAppointmentId(a?.id);
  if (bId !== null && aId !== null && bId !== aId) return bId - aId;

  return String(b?.id || "").localeCompare(String(a?.id || ""));
}

function countAppointmentFields(form) {
  if (!form) return 0;
  let count = 0;

  [
    form.bpSystolic,
    form.bpDiastolic,
    form.pulse,
    form.oxygenLevel,
    form.sugar,
    form.thyroid,
    form.weight,
    form.temperature,
    form.paymentAmount,
    form.notes
  ].forEach((value) => {
    if (String(value || "").trim() !== "") count += 1;
  });

  const hasSelectedCondition = (Array.isArray(form.pastHistoryCondition) ? form.pastHistoryCondition : [])
    .some((item) => String(item || "").trim().toUpperCase() !== "NO");
  if (hasSelectedCondition) count += 1;

  return count;
}

export default function App({
  initialAuthMode = "login",
  redirectAuthedToApp = false,
  redirectUnauthedToLogin = false
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [auth, setAuth] = useState(() => loadStoredAuth());
  const [authMode, setAuthMode] = useState(initialAuthMode === "register" ? "register" : "login");
  const [loginForm, setLoginForm] = useState({ loginId: "", password: "" });
  const [registerForm, setRegisterForm] = useState(emptyRegister());

  const [activeSection, setActiveSection] = useState("new");
  const [patientForm, setPatientForm] = useState(emptyPatient());
  const [createAppointmentNow, setCreateAppointmentNow] = useState(true);
  const [firstAppointmentForm, setFirstAppointmentForm] = useState(emptyAppointment());

  const [searchForm, setSearchForm] = useState({ firstName: "", lastName: "", phone: "" });
  const [searchKeyword, setSearchKeyword] = useState("");
  const [results, setResults] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [appointmentForm, setAppointmentForm] = useState(emptyAppointment());
  const [editingAppointmentId, setEditingAppointmentId] = useState(null);

  const [summaryView, setSummaryView] = useState("weekly");
  const [weeklySummary, setWeeklySummary] = useState([]);
  const [monthlySummary, setMonthlySummary] = useState([]);
  const [nonRepeatPatients, setNonRepeatPatients] = useState([]);

  const [loading, setLoading] = useState(false);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetForm, setResetForm] = useState({ contactNumber: "", email: "", newPassword: "" });
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState("");
  const [resetError, setResetError] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const appointmentHistoryRef = useRef(null);
  const currentYear = new Date().getFullYear();
  const calculatedPatientAge = useMemo(() => calculateAgeFromBirthYear(patientForm.birthYear), [patientForm.birthYear]);

  const isLoggedIn = useMemo(() => Boolean(auth?.token), [auth]);
  const sortedAppointments = useMemo(
    () => appointments.slice().sort(compareAppointmentsDesc),
    [appointments]
  );
  const latestAppointment = useMemo(() => sortedAppointments[0] || null, [sortedAppointments]);
  const appointmentFieldCount = useMemo(() => countAppointmentFields(appointmentForm), [appointmentForm]);
  const firstAppointmentFieldCount = useMemo(() => countAppointmentFields(firstAppointmentForm), [firstAppointmentForm]);
  const canSaveAppointment = appointmentFieldCount >= MIN_APPOINTMENT_FIELDS;
  const totalPayment = useMemo(() => appointments.reduce((sum, a) => sum + Number(a.paymentAmount || 0), 0), [appointments]);
  const appointmentMedicalHistory = useMemo(() => {
    const all = new Set();
    appointments.forEach((apt) => {
      String(apt.pastHistoryCondition || "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "" && item.toUpperCase() !== "NO")
        .forEach((item) => all.add(item));
    });
    return Array.from(all).join(", ");
  }, [appointments]);
  const patientMedicalHistory = useMemo(() => {
    if (appointmentMedicalHistory) return appointmentMedicalHistory;
    return normalizeHistoryText(selectedPatient?.medicalHistory || "");
  }, [appointmentMedicalHistory, selectedPatient]);

  useEffect(() => {
    if (redirectAuthedToApp && isLoggedIn) {
      navigate("/app", { replace: true });
    }
  }, [redirectAuthedToApp, isLoggedIn, navigate]);

  useEffect(() => {
    if (redirectUnauthedToLogin && !isLoggedIn) {
      navigate("/login", { replace: true, state: { from: location.pathname } });
    }
  }, [redirectUnauthedToLogin, isLoggedIn, navigate, location.pathname]);

  useEffect(() => {
    if (!auth?.token) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const data = await getCurrentSession(auth.token);
        if (cancelled) return;
        setAuth((prev) => {
          if (!prev?.token) return prev;
          return { ...prev, clinic: data.clinic };
        });
      } catch (_err) {
        if (cancelled) return;
        clearStoredAuth();
        setAuth(null);
        setError("Session expired. Please login again.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth?.token]);

  useEffect(() => {
    if (!auth?.token) return undefined;
    let cancelled = false;
    let timer = null;

    const nextDelay = () => HEARTBEAT_INTERVAL_MS + Math.floor(Math.random() * (HEARTBEAT_JITTER_MS + 1));

    const sendHeartbeat = async () => {
      try {
        await pingSession(auth.token);
      } catch (_err) {
        // Heartbeat failure should not break active UI session immediately.
      } finally {
        if (!cancelled) {
          timer = setTimeout(sendHeartbeat, nextDelay());
        }
      }
    };

    timer = setTimeout(sendHeartbeat, nextDelay());

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [auth?.token]);

  useEffect(() => {
    if (isLoggedIn && activeSection === "summary") loadSummary(summaryView);
  }, [isLoggedIn, activeSection, summaryView]);

  useEffect(() => {
    if (!message && !error) return undefined;
    const timeoutId = setTimeout(() => {
      setMessage("");
      setError("");
    }, 5000);
    return () => clearTimeout(timeoutId);
  }, [message, error]);

  async function onLogin(e) {
    e.preventDefault();
    setError(""); setMessage(""); setLoading(true);
    try {
      const data = await login(loginForm.loginId, loginForm.password);
      storeAuth(data);
      setAuth(data);
      setMessage(`Welcome, ${data.clinic.name}`);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  async function onRegister(e) {
    e.preventDefault();
    setError(""); setMessage(""); setLoading(true);
    try {
      const payload = {
        doctorFullName: registerForm.doctorFullName.trim(),
        doctorQualification: registerForm.doctorQualification,
        doctorGender: registerForm.doctorGender,
        clinicName: registerForm.clinicName.trim(),
        clinicAddress: registerForm.clinicAddress.trim(),
        clinicPincode: registerForm.clinicPincode.trim(),
        clinicCity: registerForm.clinicCity.trim(),
        clinicState: registerForm.clinicState.trim(),
        clinicContactNumber: registerForm.clinicContactNumber.replace(/\D/g, ""),
        clinicEmailId: registerForm.clinicEmailId.trim().toLowerCase(),
        loginPassword: registerForm.loginPassword,
        key: registerForm.key.trim(),
        consentGiven: registerForm.consentGiven
      };
      await registerClinic(payload);
      setRegisterForm(emptyRegister());
      setAuthMode("login");
      setLoginForm({ loginId: payload.clinicContactNumber, password: "" });
      setMessage("Registration successful. Please login.");
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  async function onResetPassword(e) {
    e.preventDefault();
    setResetError("");
    setResetMessage("");
    setResetLoading(true);
    try {
      const contactNumber = resetForm.contactNumber.replace(/\D/g, "");
      const email = resetForm.email.trim().toLowerCase();
      const newPassword = resetForm.newPassword;

      if (!contactNumber || !email || !newPassword) {
        throw new Error("Contact number, email id and new password are required");
      }
      if (newPassword.length > 6) {
        throw new Error("New password must be at most 6 characters");
      }

      const data = await resetPassword({ contactNumber, email, newPassword });
      setResetMessage(data.message || "Password reset successful");
      setResetForm({ contactNumber: "", email: "", newPassword: "" });
    } catch (err) {
      setResetError(err.message);
    } finally {
      setResetLoading(false);
    }
  }

  async function onAddPatient(e) {
    e.preventDefault();
    setError(""); setMessage(""); setLoading(true);
    try {
      if (!/^[A-Z\s]{1,30}$/.test(patientForm.firstName.trim())) throw new Error("Invalid first name");
      if (patientForm.lastName.trim() && !/^[A-Z\s]{1,30}$/.test(patientForm.lastName.trim())) throw new Error("Invalid surname");
      if (patientForm.phone && patientForm.phone.replace(/\D/g, "").length !== 10) throw new Error("Phone number must be exactly 10 digits");
      if (!/^\d{4}$/.test(patientForm.birthYear)) throw new Error("Birth year must be 4 digits");
      const birthYearNumber = Number(patientForm.birthYear);
      if (birthYearNumber < 1900 || birthYearNumber > currentYear) {
        throw new Error(`Birth year must be between 1900 and ${currentYear}`);
      }
      if (!patientForm.consentGiven) throw new Error("Patient consent is required as per DPDP Act (2023)");

      const payload = new FormData();
      payload.append("firstName", patientForm.firstName);
      payload.append("lastName", patientForm.lastName);
      payload.append("phone", patientForm.phone);
      payload.append("birthYear", patientForm.birthYear || "");
      payload.append("gender", patientForm.gender);
      payload.append("notes", patientForm.notes);
      payload.append("patientConsent", String(patientForm.consentGiven));
      payload.append("createAppointmentNow", String(createAppointmentNow));
      if (createAppointmentNow) {
        if (firstAppointmentFieldCount < MIN_APPOINTMENT_FIELDS) {
          throw new Error(`Add at least ${MIN_APPOINTMENT_FIELDS} appointment values before saving.`);
        }
        payload.append("bpSystolic", firstAppointmentForm.bpSystolic || "");
        payload.append("bpDiastolic", firstAppointmentForm.bpDiastolic || "");
        payload.append("pulse", firstAppointmentForm.pulse || "");
        payload.append("oxygenLevel", firstAppointmentForm.oxygenLevel || "");
        payload.append("sugar", firstAppointmentForm.sugar || "");
        payload.append("thyroid", firstAppointmentForm.thyroid || "");
        payload.append("weight", firstAppointmentForm.weight || "");
        payload.append("temperature", firstAppointmentForm.temperature || "");
        const medicalHistoryValue = Array.isArray(firstAppointmentForm.pastHistoryCondition)
          ? firstAppointmentForm.pastHistoryCondition.join(", ")
          : String(firstAppointmentForm.pastHistoryCondition || "NO");
        payload.append("pastHistoryCondition", medicalHistoryValue || "NO");
        payload.append("paymentAmount", firstAppointmentForm.paymentAmount || "");
        payload.append("appointmentNotes", firstAppointmentForm.notes || "");
        (firstAppointmentForm.reports || []).forEach((file) => payload.append("reports", file));
      }
      const data = await addPatient(auth.token, payload);
      setPatientForm(emptyPatient());
      setCreateAppointmentNow(true);
      setFirstAppointmentForm(emptyAppointment());
      setMessage(data.createdAppointment ? `Patient and appointment saved: ${data.patient.firstName} ${data.patient.lastName}` : `Patient added: ${data.patient.firstName} ${data.patient.lastName}`);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  async function onSearch(e) {
    e.preventDefault();
    setError(""); setMessage(""); setLoading(true);
    try {
      const term = String(searchKeyword || "").trim();
      let firstName = "";
      let lastName = "";
      let phone = "";

      if (/^\d+$/.test(term)) {
        phone = term;
      } else if (term) {
        const parts = term.split(/\s+/).filter(Boolean);
        firstName = normalizeNameInput(parts[0] || "");
        lastName = normalizeNameInput(parts.slice(1).join(" "));
      } else {
        firstName = searchForm.firstName;
        lastName = searchForm.lastName;
        phone = searchForm.phone;
      }

      setSearchForm({ firstName, lastName, phone });
      const data = await searchPatients(auth.token, firstName, lastName, phone);
      setResults(data.items || []);
      setMessage(`Found ${data.count} ${data.count === 1 ? "patient" : "patients"}`);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  function toggleFirstAppointmentMedicalHistory(value) {
    const current = Array.isArray(firstAppointmentForm.pastHistoryCondition)
      ? firstAppointmentForm.pastHistoryCondition
      : String(firstAppointmentForm.pastHistoryCondition || "NO")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

    let next = current;
    if (value === "NO") {
      next = ["NO"];
    } else if (current.includes(value)) {
      next = current.filter((item) => item !== value);
      if (next.length === 0) next = ["NO"];
    } else {
      next = current.filter((item) => item !== "NO");
      next = [...next, value];
    }

    setFirstAppointmentForm({ ...firstAppointmentForm, pastHistoryCondition: next });
  }

  function toggleAppointmentMedicalHistory(value) {
    const current = Array.isArray(appointmentForm.pastHistoryCondition)
      ? appointmentForm.pastHistoryCondition
      : String(appointmentForm.pastHistoryCondition || "NO")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

    let next = current;
    if (value === "NO") {
      next = ["NO"];
    } else if (current.includes(value)) {
      next = current.filter((item) => item !== value);
      if (next.length === 0) next = ["NO"];
    } else {
      next = current.filter((item) => item !== "NO");
      next = [...next, value];
    }

    setAppointmentForm({ ...appointmentForm, pastHistoryCondition: next });
  }

  async function openPatient(patient) {
    setError(""); setMessage(""); setAppointmentsLoading(true);
    try {
      const data = await getPatientAppointments(auth.token, patient.id);
      const appointmentsData = data.items || [];
      const fromAppointments = Array.from(
        new Set(
          appointmentsData.flatMap((apt) =>
            String(apt.pastHistoryCondition || "")
              .split(",")
              .map((item) => item.trim())
              .filter((item) => item !== "" && item.toUpperCase() !== "NO")
          )
        )
      ).join(", ");
      setSelectedPatient({
        ...patient,
        medicalHistory: fromAppointments || normalizeHistoryText(patient.medicalHistory || "") || "NO"
      });
      setAppointments(appointmentsData);
      setAppointmentForm(emptyAppointment());
      setEditingAppointmentId(null);
      requestAnimationFrame(() => {
        if (appointmentHistoryRef.current) {
          appointmentHistoryRef.current.scrollTop = 0;
        }
      });
    } catch (err) { setError(err.message); } finally { setAppointmentsLoading(false); }
  }

  async function onAddAppointment(e) {
    e.preventDefault();
    if (!selectedPatient) return;
    if (!canSaveAppointment) {
      setError(`Add at least ${MIN_APPOINTMENT_FIELDS} appointment values before saving.`);
      return;
    }
    setError(""); setMessage(""); setLoading(true);
    try {
      if (editingAppointmentId) {
        await updateLatestPatientAppointment(auth.token, selectedPatient.id, editingAppointmentId, appointmentForm);
      } else {
        await addPatientAppointment(auth.token, selectedPatient.id, appointmentForm);
      }
      setAppointmentForm(emptyAppointment());
      setEditingAppointmentId(null);
      await openPatient(selectedPatient);
      setMessage(editingAppointmentId ? "Appointment updated" : "Appointment added");
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  function startEditLatestAppointment() {
    if (!latestAppointment) return;
    setEditingAppointmentId(latestAppointment.id);
    setAppointmentForm({
      ...emptyAppointment(),
      ...parseBpForForm(latestAppointment),
      pulse: latestAppointment.pulse || "",
      oxygenLevel: latestAppointment.oxygenLevel || "",
      sugar: latestAppointment.sugar || "",
      thyroid: latestAppointment.thyroid || "",
      weight: latestAppointment.weight || "",
      temperature: latestAppointment.temperature || "",
      pastHistoryCondition: getHistorySelection(latestAppointment.pastHistoryCondition),
      pastHistory: latestAppointment.pastHistory || "",
      paymentAmount: latestAppointment.paymentAmount === 0 ? "0" : String(latestAppointment.paymentAmount || ""),
      notes: latestAppointment.notes || "",
      reports: []
    });
  }

  async function loadSummary(view) {
    setError(""); setSummaryLoading(true);
    try {
      if (view === "weekly") {
        const data = await getWeeklyPatientsSummary(auth.token, 4);
        setWeeklySummary(data.items || []);
      } else if (view === "monthly") {
        const data = await getMonthlyPatientsSummary(auth.token, 6);
        setMonthlySummary(data.items || []);
      } else {
        const data = await getNonRepeatPatientsSummary(auth.token);
        setNonRepeatPatients(data.items || []);
      }
    } catch (err) { setError(err.message); } finally { setSummaryLoading(false); }
  }

  function openRecordsTab() {
    setActiveSection("records");
    setSelectedPatient(null);
    setAppointments([]);
    setAppointmentForm(emptyAppointment());
    setEditingAppointmentId(null);
    setResults([]);
    setSearchForm({ firstName: "", lastName: "", phone: "" });
  }

  function openNewPatientTab() {
    setActiveSection("new");
    setPatientForm((prev) => ({ ...prev, consentGiven: true }));
  }

  async function logout() {
    const token = auth?.token;
    setLoading(true);
    setError("");
    try {
      if (token) {
        await logoutSession(token);
      }
    } catch (_err) {
      // Local logout should still proceed even if audit endpoint is unavailable.
    } finally {
      clearStoredAuth();
      setAuth(null); setResults([]); setSelectedPatient(null); setAppointments([]);
      setAppointmentForm(emptyAppointment()); setPatientForm(emptyPatient());
      setEditingAppointmentId(null);
      setCreateAppointmentNow(true); setFirstAppointmentForm(emptyAppointment());
      setSummaryView("weekly"); setWeeklySummary([]); setMonthlySummary([]); setNonRepeatPatients([]);
      setAuthMode("login"); setActiveSection("new"); setMessage("Logged out"); setError("");
      setLoading(false);
    }
  }

  return (
    <div className="page">
      {!isLoggedIn && (
        <section className="auth-surface">
          <div className="auth-grid">
            <aside className="auth-marketing">
              <Link
                to="/login"
                className="brand-logo brand-logo-wide"
                aria-label="Go to login"
                onClick={() => setAuthMode("login")}
              >
                <span className="brand-mark">D</span>
                <div className="brand-copy">
                  <strong>Digi Clinic</strong>
                  <span>Clinic EMR Portal</span>
                </div>
              </Link>
              <h2>Run your clinic like a modern practice.</h2>
              <p>Faster patient registration, appointment tracking, and summaries built for clinics in India.</p>
              <div className="auth-feature-list">
                <p><span>✓</span> DPDP Consent Ready</p>
                <p><span>✓</span> Multi-Clinic SaaS</p>
                <p><span>✓</span> Quick Search</p>
                <p><span>✓</span> Mobile-ready</p>
              </div>
              <div className="auth-tip">
                <strong>Tip</strong>
                <p>Use your clinic contact number as the login ID.</p>
              </div>
            </aside>

            <section className="auth-panel">
              {authMode === "login" ? (
                <>
                  <h3>Welcome back</h3>
                  <p className="auth-panel-subtitle">Sign in to continue to your clinic dashboard.</p>
                  <form onSubmit={onLogin} className="form-grid auth-login-form">
                    <label className="auth-login-field">Contact number<input value={loginForm.loginId} onChange={(e) => setLoginForm({ ...loginForm, loginId: e.target.value })} /></label>
                    <label className="auth-login-field">Password<input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} /></label>
                    <div className="auth-login-row">
                      <label className="auth-remember"><input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} /><span>Remember me</span></label>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => {
                          setShowResetModal(true);
                          setResetError("");
                          setResetMessage("");
                        }}
                      >
                        Forgot password?
                      </button>
                    </div>
                    <button className="auth-login-submit" disabled={loading}>{loading ? "Please wait..." : "Login"}</button>
                  </form>
                </>
              ) : (
                <>
                  <h3>Register Clinic</h3>
                  <p className="auth-panel-subtitle">Create your Digi Clinic workspace.</p>
                  <form onSubmit={onRegister} className="form-grid two">
                    <div className="full register-doctor-row">
                      <label>Doctor Full Name<input value={registerForm.doctorFullName} onChange={(e) => setRegisterForm({ ...registerForm, doctorFullName: e.target.value })} required /></label>
                      <label>Qualification
                        <select value={registerForm.doctorQualification} onChange={(e) => setRegisterForm({ ...registerForm, doctorQualification: e.target.value })} required>
                          <option value="">Select</option><option value="GP">GP</option><option value="BHMS">BHMS</option><option value="BAMS">BAMS</option><option value="MBBS">MBBS</option><option value="BDS">BDS</option>
                        </select>
                      </label>
                    </div>
                    <label>Doctor Gender
                      <select value={registerForm.doctorGender} onChange={(e) => setRegisterForm({ ...registerForm, doctorGender: e.target.value })} required>
                        <option value="">Select</option><option value="Male">Male</option><option value="Female">Female</option>
                      </select>
                    </label>
                    <label>Clinic Name<input value={registerForm.clinicName} onChange={(e) => setRegisterForm({ ...registerForm, clinicName: e.target.value })} required /></label>
                    <label className="full">Clinic Address<input value={registerForm.clinicAddress} onChange={(e) => setRegisterForm({ ...registerForm, clinicAddress: e.target.value })} required /></label>
                    <label>Pincode<input value={registerForm.clinicPincode} onChange={(e) => setRegisterForm({ ...registerForm, clinicPincode: e.target.value.replace(/[^\d]/g, "").slice(0, 6) })} required /></label>
                    <label>City<input value={registerForm.clinicCity} onChange={(e) => setRegisterForm({ ...registerForm, clinicCity: e.target.value })} required /></label>
                    <label>State
                      <select value={registerForm.clinicState} onChange={(e) => setRegisterForm({ ...registerForm, clinicState: e.target.value })} required>
                        <option value="">Select</option><option value="MH">MH</option><option value="GJ">GJ</option><option value="RJ">RJ</option>
                      </select>
                    </label>
                    <label>Clinic Contact Number<input value={registerForm.clinicContactNumber} onChange={(e) => setRegisterForm({ ...registerForm, clinicContactNumber: e.target.value.replace(/[^\d]/g, "").slice(0, 15) })} required /></label>
                    <label>Clinic Email Id<input type="email" value={registerForm.clinicEmailId} onChange={(e) => setRegisterForm({ ...registerForm, clinicEmailId: e.target.value })} required /></label>
                    <label>Login Password<input type="password" value={registerForm.loginPassword} onChange={(e) => setRegisterForm({ ...registerForm, loginPassword: e.target.value })} required /></label>
                    <label>Key<input type="password" inputMode="numeric" autoComplete="off" value={registerForm.key} onChange={(e) => setRegisterForm({ ...registerForm, key: e.target.value.replace(/[^\d]/g, "").slice(0, 5) })} required /></label>
                    <label className="full consent-row"><input type="checkbox" checked={registerForm.consentGiven} onChange={(e) => setRegisterForm({ ...registerForm, consentGiven: e.target.checked })} required /><span>I consent to store clinic details as per DPDP Act (2023).</span></label>
                    <button disabled={loading}>{loading ? "Please wait..." : "Register Clinic"}</button>
                  </form>
                </>
              )}

              <nav className="auth-inline-nav" aria-label="Quick links">
                {authMode === "login" ? (
                  <button type="button" className="auth-inline-link" onClick={() => setAuthMode("register")}>Register</button>
                ) : (
                  <button type="button" className="auth-inline-link" onClick={() => setAuthMode("login")}>Back to Login</button>
                )}
                <Link className="auth-inline-link" to="/about">About Us</Link>
                <Link className="auth-inline-link" to="/demo">Demo</Link>
                <Link className="auth-inline-link" to="/contact">Contact</Link>
              </nav>
            </section>
          </div>
        </section>
      )}

      {showResetModal && (
        <div className="modal-overlay" onClick={() => setShowResetModal(false)}>
          <section className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setShowResetModal(false)}
              aria-label="Close reset password"
            >
              X
            </button>
            <h3>Reset Password</h3>
            <form onSubmit={onResetPassword} className="form-grid">
              <label>
                Contact Number
                <input
                  value={resetForm.contactNumber}
                  onChange={(e) => setResetForm({ ...resetForm, contactNumber: e.target.value.replace(/[^\d]/g, "").slice(0, 15) })}
                  required
                />
              </label>
              <label>
                Email Id
                <input
                  type="email"
                  value={resetForm.email}
                  onChange={(e) => setResetForm({ ...resetForm, email: e.target.value })}
                  required
                />
              </label>
              <label>
                New Password
                <input
                  type="password"
                  maxLength={6}
                  value={resetForm.newPassword}
                  onChange={(e) => setResetForm({ ...resetForm, newPassword: e.target.value })}
                  required
                />
              </label>
              <button disabled={resetLoading}>{resetLoading ? "Resetting..." : "Reset"}</button>
            </form>
            {(resetMessage || resetError) && (
              <p className={resetError ? "modal-text-error" : "modal-text-ok"}>{resetError || resetMessage}</p>
            )}
          </section>
        </div>
      )}

      {isLoggedIn && (
        <>
          <section className="card tabs-card">
            <div className="section-tabs">
              <button type="button" className={activeSection === "new" ? "tab-btn active" : "tab-btn"} onClick={openNewPatientTab}>New Patient</button>
              <button type="button" className={activeSection === "records" ? "tab-btn active" : "tab-btn"} onClick={openRecordsTab}>Search</button>
              <button type="button" className={activeSection === "summary" ? "tab-btn active" : "tab-btn"} onClick={() => setActiveSection("summary")}>Summary</button>
              <span className="section-tabs-spacer" />
              <button type="button" className="secondary" onClick={logout}>Logout</button>
            </div>
          </section>

          {activeSection === "new" && (
            <section className="card">
              <form onSubmit={onAddPatient} className="form-grid two new-patient-form">
                <label>First Name<input value={patientForm.firstName} onChange={(e) => setPatientForm({ ...patientForm, firstName: normalizeNameInput(e.target.value) })} required /></label>
                <label>Surname<input value={patientForm.lastName} onChange={(e) => setPatientForm({ ...patientForm, lastName: normalizeNameInput(e.target.value) })} /></label>
                <label>
                  Birth Year
                  <div className="birth-year-row">
                    <input className="birth-year-input" value={patientForm.birthYear} onChange={(e) => setPatientForm({ ...patientForm, birthYear: e.target.value.replace(/[^\d]/g, "").slice(0, 4) })} required />
                    <span className="birth-year-value">{calculatedPatientAge === null ? "-" : `${calculatedPatientAge} year`}</span>
                  </div>
                </label>
                <label>Gender<select value={patientForm.gender} onChange={(e) => setPatientForm({ ...patientForm, gender: e.target.value })}><option value="">Select</option><option value="Male">Male</option><option value="Female">Female</option></select></label>
                <label className="full phone-compact">Phone<input value={patientForm.phone} onChange={(e) => setPatientForm({ ...patientForm, phone: e.target.value.replace(/[^\d]/g, "").slice(0, 10) })} /></label>
                <label className="full"><span>Add First Appointment Now</span><select value={createAppointmentNow ? "yes" : "no"} onChange={(e) => setCreateAppointmentNow(e.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label>
                {createAppointmentNow && (
                  <>
                    <div className="full appointment-vitals-layout">
                      <div className="appointment-vitals-col">
                        <div className="metric-row">
                          <span className="metric-label">BP</span>
                          <div className="bp-input-group">
                            <input className="bp-part-input" type="number" min="0" max="500" value={firstAppointmentForm.bpSystolic} onChange={(e) => setFirstAppointmentForm({ ...firstAppointmentForm, bpSystolic: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })} />
                            <span className="bp-separator">/</span>
                            <input className="bp-part-input" type="number" min="0" max="500" value={firstAppointmentForm.bpDiastolic} onChange={(e) => setFirstAppointmentForm({ ...firstAppointmentForm, bpDiastolic: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })} />
                          </div>
                        </div>
                        <div className="metric-row"><span className="metric-label">Pulse</span><input className="compact-input" value={firstAppointmentForm.pulse} onChange={(e) => setFirstAppointmentForm({ ...firstAppointmentForm, pulse: e.target.value })} /></div>
                        <div className="metric-row"><span className="metric-label">O2</span><input className="compact-input" value={firstAppointmentForm.oxygenLevel} onChange={(e) => setFirstAppointmentForm({ ...firstAppointmentForm, oxygenLevel: e.target.value })} /></div>
                        <div className="metric-row"><span className="metric-label">Temperature</span><input className="compact-input" value={firstAppointmentForm.temperature} onChange={(e) => setFirstAppointmentForm({ ...firstAppointmentForm, temperature: e.target.value })} /></div>
                      </div>
                      <div className="appointment-vitals-col">
                        <div className="metric-row"><span className="metric-label">HGT</span><input className="compact-input" value={firstAppointmentForm.sugar} onChange={(e) => setFirstAppointmentForm({ ...firstAppointmentForm, sugar: e.target.value })} /></div>
                        <div className="metric-row"><span className="metric-label">K/C/O</span><input className="compact-input" value={firstAppointmentForm.thyroid} onChange={(e) => setFirstAppointmentForm({ ...firstAppointmentForm, thyroid: e.target.value })} /></div>
                        <div className="metric-row"><span className="metric-label">Weight</span><input className="compact-input" value={firstAppointmentForm.weight} onChange={(e) => setFirstAppointmentForm({ ...firstAppointmentForm, weight: e.target.value })} /></div>
                      </div>
                    </div>
                    <div className="full">
                      <span className="metric-label">Medical History</span>
                      <div className="history-checks">
                        {["NO", "BP", "DIABETIC", "THYROID", "ASTHMA", "HEART DISEASE"].map((item) => (
                          <label key={item} className="history-check-item">
                            <input
                              type="checkbox"
                              checked={(firstAppointmentForm.pastHistoryCondition || []).includes(item)}
                              onChange={() => toggleFirstAppointmentMedicalHistory(item)}
                            />
                            <span>{item}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <label className="full">Appointment Notes<textarea rows="2" spellCheck={false} data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" value={firstAppointmentForm.notes} onChange={(e) => setFirstAppointmentForm({ ...firstAppointmentForm, notes: e.target.value })} /></label>
                    <label className="payment-compact">Payment Received<input type="number" min="-5000" max="5000" step="0.01" value={firstAppointmentForm.paymentAmount} onChange={(e) => setFirstAppointmentForm({ ...firstAppointmentForm, paymentAmount: e.target.value })} /></label>
                  </>
                )}
                <label className="full consent-row"><input type="checkbox" checked={patientForm.consentGiven} disabled readOnly /><span>I am patient giving consent of storing data as per DPDP Act (2023).</span></label>
                <button disabled={loading}>{loading ? "Saving..." : "Save Patient"}</button>
              </form>
            </section>
          )}

          {activeSection === "records" && (
            <>
              {!selectedPatient ? (
                <section className="records-modern-shell">
                  <section className="card records-search-card">
                    <form onSubmit={onSearch} className="records-search-form">
                      <div className="records-search-input-wrap">
                        <span className="records-search-icon" aria-hidden="true">⌕</span>
                        <input
                          className="records-search-input"
                          placeholder="Search by name or mobile..."
                          value={searchKeyword}
                          onChange={(e) => setSearchKeyword(e.target.value)}
                        />
                      </div>
                    </form>
                  </section>

                  <section className="card records-list-card">
                    <div className="records-list-head">
                      <h2>Recent Patients</h2>
                      <span className="result-badge">{results.length}</span>
                    </div>

                    <div className="records-patient-list">
                      {results.length === 0 && (
                        <p className="empty records-empty">No patients found. Search by name or mobile.</p>
                      )}

                      {results.map((patient) => {
                        const initials = `${String(patient.firstName || "").charAt(0)}${String(patient.lastName || "").charAt(0)}`
                          .toUpperCase()
                          .replace(/[^A-Z]/g, "") || "P";
                        return (
                          <article key={patient.id} className="records-patient-item">
                            <div className="records-patient-main">
                              <span className="records-avatar">{initials}</span>
                              <div>
                                <p className="records-patient-name">{patient.firstName} {patient.lastName}</p>
                                <p className="records-patient-meta">{formatPatientAgeDisplay(patient)} • {patient.gender || "-"}</p>
                                <p className="records-patient-phone">{formatPhoneCompact(patient.phone)}</p>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="records-open-btn"
                              onClick={() => openPatient(patient)}
                              disabled={appointmentsLoading}
                            >
                              Open File
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                </section>
              ) : (
                <section className="records-open-layout">
                  <section className="card records-history-panel">
                    <div className="records-list-head">
                      <h2>Appointments</h2>
                      <span className="result-badge">{appointments.length}</span>
                    </div>
                    {appointments.length === 0 && <p className="empty records-empty">No appointments yet for this patient.</p>}
                    <div className="appointment-scroll records-history-scroll" ref={appointmentHistoryRef}>
                      <div className="appointment-list">
                        {sortedAppointments.map((apt) => (
                          <div key={apt.id} className="appointment-item records-history-item">
                            <p className="appointment-title">{formatDateTime(apt.visitAt)}</p>
                            <p className="records-history-patient">{selectedPatient.firstName} {selectedPatient.lastName}</p>
                            <p className="records-history-meta">{formatPatientAgeDisplay(selectedPatient)} • {selectedPatient.gender || "-"}</p>
                            <p className="records-history-phone">{formatPhoneCompact(selectedPatient.phone)}</p>
                            <p className="records-history-summary">BP {formatBpDisplay(apt) || "-"} • SPO2 {apt.oxygenLevel || "-"} • Temp {apt.temperature || "-"}</p>
                            <p className="records-history-notes">{apt.notes || "-"}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>

                  <section className="card records-editor-panel">
                    <div className="records-editor-head">
                      <div>
                        <h2>{selectedPatient.firstName} {selectedPatient.lastName}</h2>
                        <p className="hint">{`History: ${patientMedicalHistory || "-"}`}</p>
                      </div>
                      <button
                        type="button"
                        className="secondary small-btn"
                        onClick={() => { setSelectedPatient(null); setAppointments([]); setAppointmentForm(emptyAppointment()); setEditingAppointmentId(null); }}
                      >
                        Close File
                      </button>
                    </div>

                    <form onSubmit={onAddAppointment} className="followup-form records-editor-form">
                      <div className="records-editor-actions">
                        {latestAppointment && (
                          <button
                            type="button"
                            className="secondary small-btn"
                            onClick={startEditLatestAppointment}
                          >
                            Edit Latest Appointment
                          </button>
                        )}
                      </div>
                      {editingAppointmentId && <p className="hint">Editing latest appointment</p>}
                      <div className="form-grid two">
                        <div className="full appointment-vitals-layout">
                          <div className="appointment-vitals-col">
                            <div className="metric-row">
                              <span className="metric-label">BP</span>
                              <div className="bp-input-group">
                                <input className="bp-part-input" type="number" min="0" max="500" value={appointmentForm.bpSystolic} onChange={(e) => setAppointmentForm({ ...appointmentForm, bpSystolic: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })} />
                                <span className="bp-separator">/</span>
                                <input className="bp-part-input" type="number" min="0" max="500" value={appointmentForm.bpDiastolic} onChange={(e) => setAppointmentForm({ ...appointmentForm, bpDiastolic: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })} />
                              </div>
                            </div>
                            <div className="metric-row"><span className="metric-label">Pulse</span><input className="compact-input" value={appointmentForm.pulse} onChange={(e) => setAppointmentForm({ ...appointmentForm, pulse: e.target.value })} /></div>
                            <div className="metric-row"><span className="metric-label">O2</span><input className="compact-input" value={appointmentForm.oxygenLevel} onChange={(e) => setAppointmentForm({ ...appointmentForm, oxygenLevel: e.target.value })} /></div>
                            <div className="metric-row"><span className="metric-label">Temperature</span><input className="compact-input" value={appointmentForm.temperature} onChange={(e) => setAppointmentForm({ ...appointmentForm, temperature: e.target.value })} /></div>
                          </div>
                          <div className="appointment-vitals-col">
                            <div className="metric-row"><span className="metric-label">HGT</span><input className="compact-input" value={appointmentForm.sugar} onChange={(e) => setAppointmentForm({ ...appointmentForm, sugar: e.target.value })} /></div>
                            <div className="metric-row"><span className="metric-label">K/C/O</span><input className="compact-input" value={appointmentForm.thyroid} onChange={(e) => setAppointmentForm({ ...appointmentForm, thyroid: e.target.value })} /></div>
                            <div className="metric-row"><span className="metric-label">Weight</span><input className="compact-input" value={appointmentForm.weight} onChange={(e) => setAppointmentForm({ ...appointmentForm, weight: e.target.value })} /></div>
                          </div>
                        </div>
                        <div className="full">
                          <span className="metric-label">Medical History</span>
                          <div className="history-checks">
                            {["NO", "BP", "DIABETIC", "THYROID", "ASTHMA", "HEART DISEASE"].map((item) => (
                              <label key={`apt_${item}`} className="history-check-item">
                                <input
                                  type="checkbox"
                                  checked={(appointmentForm.pastHistoryCondition || []).includes(item)}
                                  onChange={() => toggleAppointmentMedicalHistory(item)}
                                />
                                <span>{item}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <label className="full">Notes<textarea rows="2" spellCheck={false} data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" value={appointmentForm.notes} onChange={(e) => setAppointmentForm({ ...appointmentForm, notes: e.target.value })} /></label>
                        <label className="payment-compact">Payment Received<input type="number" min="-5000" max="5000" step="0.01" value={appointmentForm.paymentAmount} onChange={(e) => setAppointmentForm({ ...appointmentForm, paymentAmount: e.target.value })} /></label>
                        <div className="full action-row">
                          <button disabled={loading || !canSaveAppointment}>{loading ? "Saving..." : editingAppointmentId ? "Update Appointment" : "Save Appointment"}</button>
                          {editingAppointmentId && (
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => { setEditingAppointmentId(null); setAppointmentForm(emptyAppointment()); }}
                            >
                              Cancel Edit
                            </button>
                          )}
                        </div>
                      </div>
                    </form>
                  </section>
                </section>
              )}
            </>
          )}

          {activeSection === "summary" && (
            <section className="card">
              <h2>Summary</h2>
              <div className="summary-layout">
                <aside className="summary-menu">
                  <button type="button" className={summaryView === "weekly" ? "summary-menu-btn active" : "summary-menu-btn"} onClick={() => setSummaryView("weekly")}>Weekly Patients</button>
                  <button type="button" className={summaryView === "monthly" ? "summary-menu-btn active" : "summary-menu-btn"} onClick={() => setSummaryView("monthly")}>Monthly Patients</button>
                  <button type="button" className={summaryView === "non-repeat" ? "summary-menu-btn active" : "summary-menu-btn"} onClick={() => setSummaryView("non-repeat")}>Non Repeat Patients</button>
                </aside>
                <div className="summary-content">
                  {summaryLoading && <p className="hint">Loading summary...</p>}

                  {!summaryLoading && summaryView === "weekly" && (
                    <div className="table-wrap"><table><thead><tr><th>Week</th><th>Visited Patients</th></tr></thead><tbody>
                      {weeklySummary.length === 0 && <tr><td colSpan="2" className="empty">No visits found</td></tr>}
                      {weeklySummary.map((item) => <tr key={`${item.weekStart}_${item.weekEnd}`}><td>{item.weekStart} to {item.weekEnd}</td><td>{item.patientCount}</td></tr>)}
                    </tbody></table></div>
                  )}

                  {!summaryLoading && summaryView === "monthly" && (
                    <div className="table-wrap"><table><thead><tr><th>Month</th><th>Visited Patients</th></tr></thead><tbody>
                      {monthlySummary.length === 0 && <tr><td colSpan="2" className="empty">No visits found</td></tr>}
                      {monthlySummary.map((item) => <tr key={item.month}><td>{item.month}</td><td>{item.patientCount}</td></tr>)}
                    </tbody></table></div>
                  )}

                  {!summaryLoading && summaryView === "non-repeat" && (
                    <div className="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Age</th><th>Gender</th><th>Last Visit</th></tr></thead><tbody>
                      {nonRepeatPatients.length === 0 && <tr><td colSpan="5" className="empty">No non-repeat patients found</td></tr>}
                      {nonRepeatPatients.map((p) => <tr key={p.id}><td>{p.firstName} {p.lastName}</td><td>{p.phone || "-"}</td><td>{formatPatientAgeDisplay(p)}</td><td>{p.gender || "-"}</td><td>{formatDateTime(p.lastVisitAt)}</td></tr>)}
                    </tbody></table></div>
                  )}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {(message || error) && <footer className={error ? "alert error" : "alert ok"}>{error || message}</footer>}
    </div>
  );
}
