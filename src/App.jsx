import React, { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import AccessAssistApp from "./AccessAssistApp";
import "./auth.css";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

function AuthPage() {
  const [loginType, setLoginType] = useState("user");
  const [mode, setMode] = useState("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const switchType = (type) => {
    setLoginType(type);
    setMode(type === "admin" ? "signin" : mode);
    setError("");
    setMessage("");
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError(""); setMessage("");

    if (loginType === "admin" && mode === "signup") {
      setError("Admin accounts are created by the project administrator. Use Admin Login to sign in.");
      setLoading(false); return;
    }

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: name }, emailRedirectTo: window.location.origin }
      });
      if (error) setError(error.message);
      else if (data.session) setMessage("Account created successfully. Opening AccessAssist...");
      else setMessage("Account created. Check your email to confirm your account, then sign in.");
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      else {
        const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
        const role = profile?.role || "user";
        if (loginType === "admin" && role !== "admin") {
          await supabase.auth.signOut();
          setError("This account is not an admin account. Use User Login instead.");
        } else if (loginType === "user" && role === "admin") {
          await supabase.auth.signOut();
          setError("This is an admin account. Use Admin Login instead.");
        }
      }
    }
    setLoading(false);
  };

  const resetPassword = async () => {
    if (!email) { setError("Enter your email address first."); return; }
    setLoading(true); setError(""); setMessage("");
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) setError(error.message); else setMessage("Password reset link sent. Check your email.");
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-left">
        <div className="auth-brand">AccessAssist</div>
        <h1>Accessibility should be<br />easy to find.</h1>
        <p>Discover accessible places, report barriers, verify locations, and help make Vijayawada more inclusive.</p>
        <div className="auth-features">
          <div>♿ Personalized accessibility</div><div>📍 21+ mapped locations</div>
          <div>🤝 Community-powered verification</div><div>🚨 Accessibility Now assistance</div>
        </div>
      </div>

      <div className="auth-card">
        <div className="auth-icon">♿</div>
        <div className="login-type-switch">
          <button className={loginType === "user" ? "active" : ""} onClick={() => switchType("user")}>👤 User Login</button>
          <button className={loginType === "admin" ? "active" : ""} onClick={() => switchType("admin")}>🛡 Admin Login</button>
        </div>
        <h2>{loginType === "admin" ? "Admin Portal" : mode === "signin" ? "Welcome back" : "Create your account"}</h2>
        <p className="auth-subtitle">
          {loginType === "admin" ? "Authorized administrators only" : mode === "signin" ? "Sign in to continue to AccessAssist" : "Join the AccessAssist community"}
        </p>

        <form onSubmit={submit}>
          {mode === "signup" && loginType === "user" && <label>Full name<input type="text" placeholder="Enter your name" value={name} onChange={e => setName(e.target.value)} required /></label>}
          <label>Email<input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required /></label>
          <label>Password<input type="password" placeholder="Enter your password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required /></label>
          {mode === "signin" && <button type="button" className="forgot" onClick={resetPassword}>Forgot password?</button>}
          {error && <div className="auth-error">{error}</div>}
          {message && <div className="auth-message">{message}</div>}
          <button className="auth-submit" type="submit" disabled={loading}>{loading ? "Please wait..." : loginType === "admin" ? "Admin Sign In" : mode === "signin" ? "Sign In" : "Create Account"}</button>
        </form>

        {loginType === "user" && <>
          <div className="auth-divider"><span>or</span></div>
          <button className="switch-button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setMessage(""); }}>
            {mode === "signin" ? "New to AccessAssist? Create an account" : "Already have an account? Sign in"}
          </button>
        </>}
      </div>
    </div>
  );
}

function AdminDashboard({ user, onSignOut }) {
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("places").select("*").order("created_at", { ascending: false });
    if (!error) setPlaces(data || []); else setMsg(error.message);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const verify = async (place) => {
    setBusy(place.id); setMsg("");
    const { error } = await supabase.from("places").update({ verified: true, verified_at: new Date().toISOString() }).eq("id", place.id);
    if (error) setMsg(error.message); else await load();
    setBusy("");
  };
  const clearBarrier = async (place) => {
    setBusy(place.id); setMsg("");
    const { error } = await supabase.from("places").update({ barrier: null }).eq("id", place.id);
    if (error) setMsg(error.message); else await load();
    setBusy("");
  };

  const pending = places.filter(p => !p.verified).length;
  const barriers = places.filter(p => p.barrier).length;
  const verified = places.filter(p => p.verified).length;

  return <div className="admin-page">
    <div className="admin-aurora" />
    <header className="admin-header">
      <div><div className="admin-brand">AccessAssist <span>ADMIN</span></div><div className="admin-sub">Moderation & accessibility data control</div></div>
      <div className="admin-header-actions"><span>🛡 {user?.email}</span><button onClick={onSignOut}>↪ Sign Out</button></div>
    </header>
    <main className="admin-main">
      <div className="admin-stats">
        <div><b>{places.length}</b><span>Total Places</span></div>
        <div><b>{verified}</b><span>Verified</span></div>
        <div><b>{pending}</b><span>Pending Review</span></div>
        <div><b>{barriers}</b><span>Active Barriers</span></div>
      </div>
      <section className="admin-card">
        <div className="admin-card-title"><div><h2>Community Submissions</h2><p>Review places and active accessibility barriers.</p></div><button onClick={load}>↻ Refresh</button></div>
        {msg && <div className="admin-msg">{msg}</div>}
        {loading ? <div className="admin-empty">Loading submissions...</div> : places.length === 0 ? <div className="admin-empty">No places found.</div> : <div className="admin-list">
          {places.map(p => <div className="admin-place" key={p.id}>
            <div className="admin-place-main"><h3>{p.name}</h3><div className="admin-meta">{p.verified ? "✓ Verified" : "● Needs review"} {p.barrier ? " · ⚠ Active barrier" : ""}</div></div>
            <div className="admin-place-actions">
              {!p.verified && <button onClick={() => verify(p)} disabled={busy === p.id}>✓ Approve</button>}
              {p.barrier && <button className="danger" onClick={() => clearBarrier(p)} disabled={busy === p.id}>Clear Barrier</button>}
            </div>
          </div>)}
        </div>}
      </section>
    </main>
  </div>;
}

function App() {
  const [session, setSession] = useState(null);
  const [role, setRole] = useState("user");
  const [checking, setChecking] = useState(true);

  const loadSession = async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      setSession(data.session);
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.session.user.id).maybeSingle();
      setRole(profile?.role || "user");
    } else setSession(null);
    setChecking(false);
  };

  useEffect(() => {
    loadSession();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) setRole("user");
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (checking) return <div className="auth-loading"><div className="auth-spinner" />Loading AccessAssist...</div>;
  if (!session) return <AuthPage />;
  const signOut = async () => { await supabase.auth.signOut(); };
  if (role === "admin") return <AdminDashboard user={session.user} onSignOut={signOut} />;
  return <div className="app-auth-shell"><AccessAssistApp onSignOut={signOut} /></div>;
}

export default App;
