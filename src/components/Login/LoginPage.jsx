import { useState } from "react";
import { GraduationCap, User, Users, Shield, Lock, Eye, EyeOff, ArrowLeft, AlertCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { fetchAdminProfile } from "../../lib/adminAuth";
import "./LoginPage.css";

const ROLES = [
  { id: "student", label: "Student", icon: User },
  { id: "parent", label: "Parent", icon: Users },
  { id: "admin", label: "Admin", icon: Shield },
];

export default function LoginPage({ onLogin, onBack }) {
  const [role, setRole] = useState("student");
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    setError("");
    if (!id.trim() || !password.trim()) {
      setError("Please enter your ID and password");
      return;
    }

    setLoading(true);

    if (role === "admin") {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: id,
        password,
      });
      if (authError) {
        setLoading(false);
        setError("Invalid email or password");
        return;
      }

      const profile = await fetchAdminProfile(authData.user.id);
      setLoading(false);

      if (!profile) {
        setError("Your account has not been granted any admin permissions yet. Contact the super admin.");
        await supabase.auth.signOut();
        return;
      }

      onLogin("admin", id, profile);
      return;
    }

    if (role === "student" || role === "parent") {
      // Students table se roll number + password check karein
      const { data, error: dbError } = await supabase
        .from("students")
        .select("*")
        .eq("roll_no", id.trim())
        .eq("password", password.trim())
        .single();

      setLoading(false);

      if (dbError || !data) {
        setError("Invalid Roll Number or Password");
        return;
      }

      onLogin(role, id, data);
      return;
    }
  };

  return (
    <div className="login">
      <div className="login__card">
        <button className="login__back" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Website
        </button>

        <div className="login__header">
          <div className="login__logo"><GraduationCap size={28} /></div>
          <h1>CMGC Portal Login</h1>
          <p>Community Model Girls College</p>
        </div>

        <div className="login__roles">
          {ROLES.map((r) => (
            <button key={r.id} onClick={() => { setRole(r.id); setError(""); }} className={`login__role-btn ${role === r.id ? "login__role-btn--active" : ""}`}>
              <r.icon size={14} /> {r.label}
            </button>
          ))}
        </div>

        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          placeholder={role === "admin" ? "Admin Email" : "Roll Number (e.g. CMGC-2026-001)"}
          className="login__input"
        />
        <div className="login__password-wrap">
          <input
            type={showPass ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="Password"
            className="login__input"
          />
          <button className="login__eye" onClick={() => setShowPass(!showPass)}>
            {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {error && <p className="login__error"><AlertCircle size={13} /> {error}</p>}

        <button onClick={handleLogin} className="login__submit" disabled={loading}>
          <Lock size={16} /> {loading ? "Logging in..." : "Login"}
        </button>
        <p className="login__forgot">Forgot Password?</p>
      </div>
    </div>
  );
}