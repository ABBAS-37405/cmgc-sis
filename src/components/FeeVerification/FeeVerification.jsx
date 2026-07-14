import { useState, useEffect } from "react";
import { Check, X, Eye } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./FeeVerification.css";

export default function FeeVerification() {
  const [pending, setPending] = useState([]);
  const [unpaidFees, setUnpaidFees] = useState([]);
  const [yearFilter, setYearFilter] = useState("Both");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState("pending");
  const [allTransactions, setAllTransactions] = useState([]);
  const [editingFeeId, setEditingFeeId] = useState(null);
  const [feeAdjustmentAmount, setFeeAdjustmentAmount] = useState("");
  const [savingAdjustment, setSavingAdjustment] = useState(false);

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

  const fetchUnpaidFees = async () => {
    const { data: feesData } = await supabase
      .from("fees")
      .select("id, student_id, amount_due, amount_paid, due_date, status")
      .order("due_date", { ascending: true });

    if (feesData) {
      const enriched = await Promise.all(
        feesData.map(async (fee) => {
          const { data: student } = await supabase
            .from("students")
            .select("id, name, roll_no, program, year_of_study")
            .eq("id", fee.student_id)
            .single();

          const { data: transactions } = await supabase
            .from("payment_transactions")
            .select("amount, status")
            .eq("fee_id", fee.id)
            .eq("status", "Success");

          const paidAmount = (transactions || []).reduce((sum, txn) => sum + Number(txn.amount || 0), 0);
          const remainingAmount = Math.max(Number(fee.amount_due || 0) - paidAmount, 0);
          return { ...fee, student, remaining_amount: remainingAmount };
        })
      );

      setUnpaidFees(enriched.filter((fee) => Number(fee.remaining_amount || 0) > 0 && !["Paid"].includes(fee.status)));
    }
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

  useEffect(() => {
    const loadData = async () => {
      await fetchPending();
      await fetchUnpaidFees();
      await fetchAll();
    };
    loadData();
  }, []);

  const resolve = async (txn, newStatus) => {
    setProcessing(true);
    await supabase
      .from("payment_transactions")
      .update({ status: newStatus, verified_by: "Admin" })
      .eq("id", txn.id);

      if (newStatus === "Success") {
      const { data: feeData, error: feeError } = await supabase
        .from("fees")
        .select("amount_due")
        .eq("id", txn.fee_id)
        .single();

      const { data: successTxns, error: txnError } = await supabase
        .from("payment_transactions")
        .select("amount, created_at")
        .eq("fee_id", txn.fee_id)
        .eq("status", "Success");

      if (feeError || txnError) {
        console.error("Failed to resolve fee approval:", feeError || txnError);
      }

      const paidAmount = (successTxns || []).reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const latestPaymentDate = (successTxns || []).reduce((latest, t) => {
        if (!t.created_at) return latest;
        const txDate = new Date(t.created_at);
        return !latest || txDate > latest ? txDate : latest;
      }, null);
      const remaining = Math.max(Number(feeData?.amount_due || 0) - paidAmount, 0);

      await supabase
        .from("fees")
        .update({
          status: remaining > 0 ? "Partially Paid" : "Paid",
          amount_paid: paidAmount,
          last_payment_date: latestPaymentDate ? latestPaymentDate.toISOString() : new Date().toISOString(),
        })
        .eq("id", txn.fee_id);
    } else {
      const { data: feeData } = await supabase
        .from("fees")
        .select("amount_due, amount_paid")
        .eq("id", txn.fee_id)
        .single();

      const previousPaid = Number(feeData?.amount_paid || 0);
      const remaining = Math.max(Number(feeData?.amount_due || 0) - previousPaid, 0);
      await supabase
        .from("fees")
        .update({ status: remaining > 0 ? (previousPaid > 0 ? "Partially Paid" : "Unpaid") : "Paid" })
        .eq("id", txn.fee_id);
    }

    setPending((p) => p.filter((t) => t.id !== txn.id));
    setProcessing(false);
    await fetchPending();
    await fetchUnpaidFees();
    await fetchAll();
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

  const filteredUnpaidFees = unpaidFees.filter((fee) => {
    if (yearFilter === "Both") return true;
    return fee.student?.year_of_study === yearFilter;
  });

  const startFeeEdit = (fee) => {
    setEditingFeeId(fee.id);
    setFeeAdjustmentAmount(String(fee.amount_due || ""));
  };

  const saveFeeAdjustment = async (fee) => {
    if (!feeAdjustmentAmount || isNaN(feeAdjustmentAmount)) return;
    setSavingAdjustment(true);

    const { data: transactions } = await supabase
      .from("payment_transactions")
      .select("amount, status")
      .eq("fee_id", fee.id)
      .eq("status", "Success");

    const paidAmount = (transactions || []).reduce((sum, txn) => sum + Number(txn.amount || 0), 0);
    const newRemainingAmount = Math.max(Number(feeAdjustmentAmount), 0);
    const newTotalDue = paidAmount + newRemainingAmount;
    const newStatus = newRemainingAmount > 0
      ? (fee.status === "Pending Verification" ? "Pending Verification" : (paidAmount > 0 ? "Partially Paid" : "Unpaid"))
      : "Paid";

    const { error } = await supabase
      .from("fees")
      .update({
        amount_due: newTotalDue,
        amount_paid: paidAmount,
        status: newStatus,
      })
      .eq("id", fee.id);

    setSavingAdjustment(false);
    if (error) {
      alert("Failed to update fee amount: " + error.message);
      return;
    }
    setEditingFeeId(null);
    setFeeAdjustmentAmount("");
    await fetchPending();
    await fetchUnpaidFees();
    await fetchAll();
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
          onClick={() => setActiveTab("unpaid")}
          className={"fee-v__tab " + (activeTab === "unpaid" ? "fee-v__tab--active" : "")}
        >
          Unpaid Fee
          {unpaidFees.length > 0 && (
            <span className="fee-v__count">{unpaidFees.length}</span>
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
                      {p.payment_method} &bull; {p.payment_method === "Cash in College Office" ? "Receipt" : "Ref"}: {p.reference_number} &bull; Rs{" "}
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

      {activeTab === "unpaid" && (
        <div>
          <div className="fee-v__year-filters" role="group" aria-label="Filter by class year">
            <button onClick={() => setYearFilter("1st Year")} className={"fee-v__year-btn " + (yearFilter === "1st Year" ? "fee-v__year-btn--active" : "")}>1st Year</button>
            <button onClick={() => setYearFilter("2nd Year")} className={"fee-v__year-btn " + (yearFilter === "2nd Year" ? "fee-v__year-btn--active" : "")}>2nd Year</button>
            <button onClick={() => setYearFilter("Both")} className={"fee-v__year-btn " + (yearFilter === "Both" ? "fee-v__year-btn--active" : "")}>Both</button>
          </div>
          <div className="fee-v__table-wrap">
            {filteredUnpaidFees.length === 0 ? (
              <p className="fee-v__empty">No unpaid fees found</p>
            ) : (
              <table className="fee-v__table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Roll No</th>
                  <th>Program</th>
                  <th>Year</th>
                  <th>Pending Fee</th>
                  <th>Due Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredUnpaidFees.map((fee) => (
                  <tr key={fee.id}>
                    <td>
                      <p className="fee-v__student-name">
                        {fee.student ? fee.student.name : "Unknown"}
                      </p>
                    </td>
                    <td>{fee.student ? fee.student.roll_no : "—"}</td>
                    <td>{fee.student ? fee.student.program : "—"}</td>
                    <td>{fee.student && fee.student.year_of_study ? fee.student.year_of_study : "—"}</td>
                    <td>Rs {fee.remaining_amount ? fee.remaining_amount.toLocaleString() : "—"}</td>
                    <td>
                      {fee.due_date ? new Date(fee.due_date).toLocaleDateString("en-PK", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      }) : "—"}
                    </td>
                    <td>
                      {editingFeeId === fee.id ? (
                        <div className="fee-v__edit-row">
                          <input
                            type="number"
                            value={feeAdjustmentAmount}
                            onChange={(e) => setFeeAdjustmentAmount(e.target.value)}
                          />
                          <button onClick={() => saveFeeAdjustment(fee)} disabled={savingAdjustment} className="fee-v__view">
                            {savingAdjustment ? "Saving..." : "Save"}
                          </button>
                          <button onClick={() => setEditingFeeId(null)} className="fee-v__reject">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => startFeeEdit(fee)} className="fee-v__view">Edit Fee</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            )}
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