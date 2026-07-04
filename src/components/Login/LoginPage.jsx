import { useState } from "react";
import { GraduationCap, User, Users, Shield, Lock, Eye, EyeOff, ArrowLeft, AlertCircle } from "lucide-react";
import WorkingOnIt from "../WorkingOnIt/WorkingOnIt";
import { supabase } from "../../lib/supabaseClient";
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

    if (role === "admin") {
      if (!id.trim() || !password.trim()) {
        setError("Please enter email and password");
        return;
      }
      setLoading(true);
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: id,
        password: password,
      });
      setLoading(false);

      if (authError) {
        setError("Invalid email or password");
        return;
      }
      onLogin(role, id);
      return;
    }

    // Student/Parent — still mock for now
    if (id.trim() && password.trim()) onLogin(role, id);
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
  placeholder={role === "admin" ? "Admin Email" : "Roll Number / ID"}
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
          <button className="login__eye" onClick={() => setShowPass(!showPass)}>{showPass ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </div>

        {error && <p className="login__error"><AlertCircle size={13} /> {error}</p>}

        <button onClick={handleLogin} className="login__submit" disabled={loading}>
          <Lock size={16} /> {loading ? "Logging in..." : "Login"}
        </button>
        <p className="login__forgot">Forgot Password?</p>

        {role !== "admin" && (
          <div className="login__footer">
            <WorkingOnIt text="Real login verification — pending Supabase Auth connection" />
          </div>
        )}
      </div>
    </div>
  );
}