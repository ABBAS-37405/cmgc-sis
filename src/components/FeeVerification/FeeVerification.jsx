import { useState, useEffect } from "react";
import { Check, X, Eye } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./FeeVerification.css";

export default function FeeVerification() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState("pending");
  const [allTransactions, setAllTransactions] = useState([]);

  useEffect(() => {
    fetchPending();
    fetchAll();
  }, []);

  const fetchPending = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("payment_transactions")
      .select("*")
      .eq("status", "Pending Verification")
      .order("created_at", { ascending: false });

    if (data) {
      const enriched = await Promise.all(
        data.map(async (txn) => {
          const { data: fee } = await supabase
            .from("fees")
            .select("*, students(name, roll_no, program)")
            .eq("id", txn.fee_id)
            .single();
          return { ...txn, fees: fee };
        })
      );
      setPending(enriched);
    }
    setLoading(false);
  };

  const fetchAll = async () => {
    const { data } = await supabase
      .from("payment_transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);

    if (data) {
      const enriched = await Promise.all(
        data.map(async (txn) => {
          const { data: fee } = await supabase
            .from("fees")
            .select("*, students(name, roll_no, program)")
            .eq("id", txn.fee_id)
            .single();
          return { ...txn, fees: fee };
        })
      );
      setAllTransactions(enriched);
    }
  };

  const resolve = async (txn, newStatus) => {
    setProcessing(true);
    await supabase
      .from("payment_transactions")
      .update({ status: newStatus, verified_by: "Admin" })
      .eq("id", txn.id);

    if (newStatus === "Success") {
      await supabase
        .from("fees")
        .update({
          status: "Paid",
          amount_paid: txn.amount,
          last_payment_date: new Date().toISOString(),
        })
        .eq("id", txn.fee_id);
    } else {
      await supabase
        .from("fees")
        .update({ status: "Unpaid" })
        .eq("id", txn.fee_id);
    }

    setPending((p) => p.filter((t) => t.id !== txn.id));
    setProcessing(false);
    fetchAll();
  };

  const statusBadge = (status) => {
    const map = {
      "Pending Verification": "fee-v__badge--pending",
      Success: "fee-v__badge--success",
      Rejected: "fee-v__badge--rejected",
      Failed: "fee-v__badge--rejected",
    };
    return (
      <span className={"fee-v__badge " + (map[status] || "fee-v__badge--pending")}>
        {status}
      </span>
    );
  };

  const openReceipt = (url) => {
    window.open(url, "_blank");
  };

  return (
    <div className="fee-v">
      <div className="fee-v__tabs">
        <button
          onClick={() => setActiveTab("pending")}
          className={"fee-v__tab " + (activeTab === "pending" ? "fee-v__tab--active" : "")}
        >
          Pending Verification
          {pending.length > 0 && (
            <span className="fee-v__count">{pending.length}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("all")}
          className={"fee-v__tab " + (activeTab === "all" ? "fee-v__tab--active" : "")}
        >
          All Transactions
        </button>
      </div>

      {activeTab === "pending" && (
        <div>
          {loading ? (
            <p className="fee-v__empty">Loading...</p>
          ) : pending.length === 0 ? (
            <div className="fee-v__empty">
              <Check size={32} className="fee-v__empty-icon" />
              <p>No pending verifications</p>
            </div>
          ) : (
            <div className="fee-v__list">
              {pending.map((p) => (
                <div key={p.id} className="fee-v__card">
                  <div className="fee-v__card-info">
                    <p className="fee-v__student-name">
                      {p.fees && p.fees.students ? p.fees.students.name : "Unknown"}
                      <span>
                        {" "}
                        (
                        {p.fees && p.fees.students
                          ? p.fees.students.roll_no
                          : "—"}
                        )
                      </span>
                    </p>
                    <p className="fee-v__meta">
                      {p.payment_method} &bull; Ref: {p.reference_number} &bull; Rs{" "}
                      {p.amount ? p.amount.toLocaleString() : "—"}
                    </p>
                    <p className="fee-v__date">
                      {new Date(p.created_at).toLocaleDateString("en-PK", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <div className="fee-v__card-actions">
                    {p.proof_image_url ? (
                      <button
                        onClick={() => openReceipt(p.proof_image_url)}
                        className="fee-v__view"
                      >
                        <Eye size={14} /> Receipt
                      </button>
                    ) : null}
                    <button
                      onClick={() => resolve(p, "Success")}
                      disabled={processing}
                      className="fee-v__approve"
                    >
                      <Check size={13} /> Approve
                    </button>
                    <button
                      onClick={() => resolve(p, "Rejected")}
                      disabled={processing}
                      className="fee-v__reject"
                    >
                      <X size={13} /> Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="fee-v__note">
            <p>
              Approving will mark fee as <strong>Paid</strong>. Rejecting will
              keep it <strong>Unpaid</strong>.
            </p>
          </div>
        </div>
      )}

      {activeTab === "all" && (
        <div className="fee-v__table-wrap">
          {allTransactions.length === 0 ? (
            <p className="fee-v__empty">No transactions yet</p>
          ) : (
            <table className="fee-v__table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Reference</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {allTransactions.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <p className="fee-v__student-name">
                        {t.fees && t.fees.students ? t.fees.students.name : "—"}
                      </p>
                      <p className="fee-v__roll">
                        {t.fees && t.fees.students ? t.fees.students.roll_no : ""}
                      </p>
                    </td>
                    <td>{t.payment_method}</td>
                    <td>Rs {t.amount ? t.amount.toLocaleString() : "—"}</td>
                    <td>{t.reference_number || "—"}</td>
                    <td>
                      {new Date(t.created_at).toLocaleDateString("en-PK", {
                        day: "numeric",
                        month: "short",
                      })}
                    </td>
                    <td>{statusBadge(t.status)}</td>
                    <td>
                      {t.proof_image_url ? (
                        <button
                          onClick={() => openReceipt(t.proof_image_url)}
                          className="fee-v__view"
                        >
                          <Eye size={14} /> View
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}