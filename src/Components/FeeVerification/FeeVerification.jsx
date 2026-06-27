import { useState } from "react";
import { Check, X } from "lucide-react";
import WorkingOnIt from "../WorkingOnIt/WorkingOnIt";
import "./FeeVerification.css";

const INITIAL = [
  { id: 1, name: "Sana Riaz", roll: "CMGC-2026-048", amount: "Rs 8,500", method: "Bank Al Habib", ref: "TXN-88213" },
  { id: 2, name: "Mahnoor Tariq", roll: "CMGC-2026-052", amount: "Rs 8,500", method: "Easypaisa Direct", ref: "TXN-88290" },
  { id: 3, name: "Hira Shahzad", roll: "CMGC-2026-059", amount: "Rs 8,500", method: "Bank Al Habib", ref: "TXN-88305" },
];

export default function FeeVerification() {
  const [pending, setPending] = useState(INITIAL);
  const resolve = (id) => setPending(pending.filter((p) => p.id !== id));

  return (
    <div className="fee-verification">
      {pending.length === 0 && <div className="fee-verification__empty">No pending verifications 🎉</div>}
      {pending.map((p) => (
        <div key={p.id} className="fee-verification__card">
          <div>
            <p className="fee-verification__name">{p.name} <span>({p.roll})</span></p>
            <p className="fee-verification__meta">{p.method} • Ref: {p.ref} • {p.amount}</p>
          </div>
          <div className="fee-verification__actions">
            <button className="fee-verification__view">View Receipt</button>
            <button onClick={() => resolve(p.id)} className="fee-verification__approve"><Check size={12} /> Approve</button>
            <button onClick={() => resolve(p.id)} className="fee-verification__reject"><X size={12} /> Reject</button>
          </div>
        </div>
      ))}
      <WorkingOnIt text="Real receipt viewing & permanent status update — pending Supabase connection" />
    </div>
  );
}