import { useState } from "react";
import { GraduationCap, User, Users, Shield, Lock, Eye, EyeOff, ArrowLeft } from "lucide-react";
import WorkingOnIt from "../WorkingOnIt/WorkingOnIt";
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

  const handleLogin = () => {
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
            <button key={r.id} onClick={() => setRole(r.id)} className={`login__role-btn ${role === r.id ? "login__role-btn--active" : ""}`}>
              <r.icon size={14} /> {r.label}
            </button>
          ))}
        </div>

        <input value={id} onChange={(e) => setId(e.target.value)} placeholder={role === "admin" ? "Admin Username" : "Roll Number / ID"} className="login__input" />
        <div className="login__password-wrap">
          <input type={showPass ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="login__input" />
          <button className="login__eye" onClick={() => setShowPass(!showPass)}>{showPass ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </div>
        <button onClick={handleLogin} className="login__submit"><Lock size={16} /> Login</button>
        <p className="login__forgot">Forgot Password?</p>

        <div className="login__footer">
          <WorkingOnIt text="Real login verification — pending Supabase Auth connection" />
        </div>
      </div>
    </div>
  );
}