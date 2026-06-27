import { useState } from "react";
import { XCircle, CheckCircle, ChevronRight } from "lucide-react";
import WorkingOnIt from "../WorkingOnIt/WorkingOnIt";
import "./Fee.css";

export default function Fee() {
  const [showMethods, setShowMethods] = useState(false);
  const history = [
    { month: "May 2026", amount: "Rs 8,500", status: "Paid" },
    { month: "April 2026", amount: "Rs 8,500", status: "Paid" },
  ];
  const methods = [
    { label: "JazzCash / Card", auto: true },
    { label: "Easypaisa", auto: true },
    { label: "College Easypaisa Account", auto: false },
    { label: "Bank Al Habib Transfer", auto: false },
  ];

  return (
    <div className="fee">
      <div className="fee__card">
        <div className="fee__header">
          <h3>June 2026 Fee</h3>
          <span className="fee__badge fee__badge--unpaid"><XCircle size={12} /> Unpaid</span>
        </div>
        <p className="fee__amount">Rs 8,500</p>
        <p className="fee__due">Due Date: June 30, 2026</p>
        <button className="fee__pay-btn" onClick={() => setShowMethods(!showMethods)}>Pay Now <ChevronRight size={16} /></button>

        {showMethods && (
          <div className="fee__methods">
            {methods.map((m) => (
              <div key={m.label} className="fee__method">
                <p>{m.label}</p>
                <span className={`fee__method-tag ${m.auto ? "fee__method-tag--auto" : "fee__method-tag--manual"}`}>
                  {m.auto ? "Auto-verify" : "Manual verify"}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="fee__working"><WorkingOnIt text="Payment gateway integration — pending merchant setup" /></div>
      </div>

      <div className="fee__card">
        <h3>Payment History</h3>
        {history.map((h) => (
          <div key={h.month} className="fee__history-row">
            <span className="fee__muted">{h.month}</span>
            <span>{h.amount}</span>
            <span className="fee__badge fee__badge--paid"><CheckCircle size={11} /> {h.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}