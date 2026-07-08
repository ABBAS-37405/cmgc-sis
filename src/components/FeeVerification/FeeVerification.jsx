import { useState, useEffect } from "react";
import { CheckCircle, XCircle, ChevronRight } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./FeeVerification.css";

export default function Fee({ studentId }) {
  const [fees, setFees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showMethods, setShowMethods] = useState(null);

  const methods = [
    { label: "JazzCash / Card", auto: true },
    { label: "Easypaisa", auto: true },
    { label: "College Easypaisa Account\n03XX-XXXXXXX", auto: false },
    { label: "Bank Al Habib\nIBAN: PKXXBAHL XXXXXXXXXXXXXXXX", auto: false },
  ];

  useEffect(() => {
    if (studentId) fetchFees();
  }, [studentId]);

  const fetchFees = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("fees")
      .select("*")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });
    if (data) setFees(data);
    setLoading(false);
  };

  const statusBadge = (status) => {
    if (status === "Paid") return <span className="fee__badge fee__badge--paid"><CheckCircle size={12} /> Paid</span>;
    if (status === "Pending Verification") return <span className="fee__badge fee__badge--pending">⏳ Pending Verification</span>;
    return <span className="fee__badge fee__badge--unpaid"><XCircle size={12} /> Unpaid</span>;
  };

  if (loading) return <div className="fee"><p style={{ textAlign: "center", color: "var(--subtext)", padding: "32px" }}>Loading fee records...</p></div>;

  return (
    <div className="fee">
      {fees.length === 0 ? (
        <div className="fee__card">
          <p style={{ textAlign: "center", color: "var(--subtext)", padding: "20px" }}>No fee records found</p>
        </div>
      ) : (
        fees.map((f) => (
          <div key={f.id} className="fee__card">
            <div className="fee__header">
              <h3>{f.program} — Fee</h3>
              {statusBadge(f.status)}
            </div>
            <p className="fee__amount">Rs {f.amount_due?.toLocaleString()}</p>
            {f.due_date && <p className="fee__due">Due Date: {new Date(f.due_date).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" })}</p>}
            {f.last_payment_date && <p className="fee__due">Paid on: {new Date(f.last_payment_date).toLocaleDateString("en-PK")}</p>}

            {f.status === "Unpaid" && (
              <>
                <button className="fee__pay-btn" onClick={() => setShowMethods(showMethods === f.id ? null : f.id)}>
                  Pay Now <ChevronRight size={16} />
                </button>
                {showMethods === f.id && (
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
              </>
            )}
          </div>
        ))
      )}
    </div>
  );
}