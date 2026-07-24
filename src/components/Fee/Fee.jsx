import { useState, useEffect, useRef, useCallback } from "react";
import { CheckCircle, XCircle, ChevronDown, ChevronUp, Upload, FileCheck, Wallet, Calendar } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./Fee.css";

const buildProofPath = (fileName) => `payment-proofs/${new Date().getTime()}-${fileName}`;

const COLLEGE_ACCOUNTS = [
  {
    method: "Easypaisa",
    icon: "💚",
    details: [
      { label: "Account Title", value: "Qaiser Abbas Humayun" },
      { label: "Easypaisa Number", value: "0333-5221914" },
    ],
  },
  {
    method: "Bank Al Habib",
    icon: "🏦",
    details: [
      { label: "Account Title", value: "Qaiser Abbas Humayun" },
      { label: "Account Number", value: "0077098101228001" },
      { label: "IBAN", value: "PK39BAHL0077098101228001" },
      { label: "Bank", value: "Bank Al Habib" },
    ],
  },
  {
    method: "Raast ID",
    icon: "⚡",
    details: [
      { label: "Raast ID", value: "0333-5221914" },
      { label: "Account Title", value: "Qaiser Abbas Humayun" },
    ],
  },
  {
    method: "Cash in College Office",
    icon: "💵",
    details: [
      { label: "Location", value: "College Office" },
      { label: "Note", value: "Pay in cash and submit the receipt number below" },
    ],
  },
];

export default function Fee({ studentId }) {
  const [fees, setFees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showMethods, setShowMethods] = useState(null);
  const [showProofForm, setShowProofForm] = useState(null);
  const [proofFile, setProofFile] = useState(null);
  const [refNumber, setRefNumber] = useState("");
  const [selectedMethod, setSelectedMethod] = useState("Easypaisa");
  const [amount, setAmount] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef();

  const fetchFees = useCallback(async () => {
    setLoading(true);
    const { data: feesData } = await supabase
      .from("fees")
      .select("*")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });

    if (feesData && feesData.length > 0) {
      const feeIds = feesData.map((fee) => fee.id);
      const { data: transactions } = await supabase
        .from("payment_transactions")
        .select("fee_id, amount, status, created_at, proof_image_url, reference_number, payment_method, recorded_by")
        .in("fee_id", feeIds)
        .eq("status", "Success");

      const paidByFeeId = {};
      const lastPaymentDateByFeeId = {};
      const txnsByFeeId = {};
      (transactions || []).forEach((txn) => {
        paidByFeeId[txn.fee_id] = (paidByFeeId[txn.fee_id] || 0) + Number(txn.amount || 0);
        txnsByFeeId[txn.fee_id] = txnsByFeeId[txn.fee_id] || [];
        txnsByFeeId[txn.fee_id].push(txn);
        if (txn.created_at) {
          const txnDate = new Date(txn.created_at);
          const existingDate = lastPaymentDateByFeeId[txn.fee_id]
            ? new Date(lastPaymentDateByFeeId[txn.fee_id])
            : null;
          if (!existingDate || txnDate > existingDate) {
            lastPaymentDateByFeeId[txn.fee_id] = txn.created_at;
          }
        }
      });

      const enrichedFees = feesData.map((fee) => {
        const paidAmount = Number(paidByFeeId[fee.id] || 0);
        const remainingAmount = Math.max(Number(fee.amount_due || 0) - paidAmount, 0);
        const computedStatus = remainingAmount === 0 ? "Paid" : fee.status;
        const computedLastPaymentDate = fee.last_payment_date || lastPaymentDateByFeeId[fee.id];
        return {
          ...fee,
          amount_paid: paidAmount,
          remaining_amount: remainingAmount,
          status: computedStatus,
          last_payment_date: computedLastPaymentDate,
          transactions: txnsByFeeId[fee.id] || [],
        };
      });

      setFees(enrichedFees);
    } else {
      setFees([]);
    }

    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    if (!studentId) return;
    const load = async () => {
      await fetchFees();
    };
    load();
  }, [studentId, fetchFees]);

  const handleProofSubmit = async (feeId) => {
    setUploadError("");
    if (!proofFile) return setUploadError("Please select a screenshot or photo");
    if (!refNumber.trim()) return setUploadError(paymentReferenceError);
    if (!amount || isNaN(amount)) return setUploadError("Please enter amount paid");

    setUploading(true);

    // Upload proof to Supabase Storage
    const path = buildProofPath(proofFile.name);
    const { error: uploadErr } = await supabase.storage
      .from("admission-documents")
      .upload(path, proofFile);

    if (uploadErr) {
      setUploadError("File upload failed: " + uploadErr.message);
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage
      .from("admission-documents")
      .getPublicUrl(path);

    // Insert payment transaction
    const { error: txnErr } = await supabase
      .from("payment_transactions")
      .insert({
        fee_id: feeId,
        payment_method: selectedMethod,
        amount: parseFloat(amount),
        reference_number: refNumber,
        proof_image_url: urlData.publicUrl,
        status: "Pending Verification",
      });

    if (txnErr) {
      setUploadError("Submission failed: " + txnErr.message);
      setUploading(false);
      return;
    }

    // Update fee status to Pending Verification
    await supabase
      .from("fees")
      .update({ status: "Pending Verification" })
      .eq("id", feeId);

    setUploading(false);
    setUploadSuccess(true);
    setProofFile(null);
    setRefNumber("");
    setAmount("");
    setShowProofForm(null);
    setShowMethods(null);
    fetchFees();
  };

  const statusBadge = (status, remainingAmount) => {
    if (remainingAmount === 0) return <span className="fee__badge fee__badge--paid"><CheckCircle size={12} /> Paid</span>;
    if (status === "Paid") return <span className="fee__badge fee__badge--paid"><CheckCircle size={12} /> Paid</span>;
    if (status === "Partially Paid") return <span className="fee__badge fee__badge--pending">⚠️ Partially Paid</span>;
    if (status === "Pending Verification") return <span className="fee__badge fee__badge--pending">⏳ Pending Verification</span>;
    return <span className="fee__badge fee__badge--unpaid"><XCircle size={12} /> Unpaid</span>;
  };

  const isCashMethod = selectedMethod === "Cash in College Office";
  const paymentReferenceLabel = isCashMethod ? "Receipt Number *" : "Transaction Reference Number *";
  const paymentReferencePlaceholder = isCashMethod ? "e.g. RCPT-1001" : "e.g. TXN-123456";
  const paymentReferenceError = isCashMethod ? "Please enter receipt number" : "Please enter transaction reference number";

  if (loading) return <div className="fee"><p className="fee__loading">Loading fee records...</p></div>;

  const totalPending = fees.reduce((sum, f) => sum + Number(f.remaining_amount ?? 0), 0);
  const pendingCount = fees.filter((f) => Number(f.remaining_amount ?? 0) > 0).length;

  return (
    <div className="fee">
      {uploadSuccess && (
        <div className="fee__success-banner">
          <CheckCircle size={16} /> Payment proof submitted successfully! Admin will verify within 24-48 hours.
        </div>
      )}

      {fees.length === 0 ? (
        <div className="fee__card">
          <p className="fee__empty">No fee records found</p>
        </div>
      ) : (
        <>
          {fees.length > 1 && pendingCount > 0 && (
            <div className="fee__summary">
              <div className="fee__summary-icon"><Wallet size={20} /></div>
              <div className="fee__summary-text">
                <p className="fee__summary-label">Total Pending Across All Fees</p>
                <p className="fee__summary-value">Rs {totalPending.toLocaleString()}</p>
              </div>
              <span className="fee__summary-badge">{pendingCount} pending</span>
            </div>
          )}

          <div className="fee__list">
            {fees.map((f) => {
              const remaining = Number(f.remaining_amount ?? 0);
              const due = Number(f.amount_due || 0);
              const paidSoFar = Math.max(due - remaining, 0);
              const paidPercent = due > 0 ? Math.min(100, Math.round((paidSoFar / due) * 100)) : 0;
              const isPaid = f.status === "Paid" || remaining === 0;

              return (
                <div key={f.id} className="fee__card">
                  <div className="fee__header">
                    <div className="fee__title">
                      <span className="fee__title-icon"><Wallet size={16} /></span>
                      <h3>{f.program}</h3>
                    </div>
                    {statusBadge(f.status, remaining)}
                  </div>

                  <div className={"fee__amount-block" + (isPaid ? " fee__amount-block--paid" : "")}>
                    <p className="fee__amount-value">Rs {remaining.toLocaleString()}</p>
                    <p className="fee__amount-caption">{isPaid ? "Fully paid — thank you!" : "amount due"}</p>
                  </div>

                  {!isPaid && paidSoFar > 0 && (
                    <div className="fee__progress">
                      <div className="fee__progress-track">
                        <div className="fee__progress-fill" style={{ width: `${paidPercent}%` }} />
                      </div>
                      <p className="fee__progress-label">
                        Rs {paidSoFar.toLocaleString()} paid of Rs {due.toLocaleString()} ({paidPercent}%)
                      </p>
                    </div>
                  )}

                  <div className="fee__meta-row">
                    {f.due_date && (
                      <span className="fee__meta-chip">
                        <Calendar size={12} />
                        Due {new Date(f.due_date).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    )}
                    {f.last_payment_date && (
                      <span className="fee__meta-chip fee__meta-chip--paid">
                        <CheckCircle size={12} />
                        Paid on {new Date(f.last_payment_date).toLocaleDateString("en-PK")}
                      </span>
                    )}
                  </div>

                  {f.transactions && f.transactions.length > 0 && (
                    <div className="fee__payments">
                      <h4>Payment History</h4>
                      <div className="fee__payments-table-wrap">
                        <table className="fee__payments-table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Amount</th>
                              <th>Method</th>
                              <th>Reference</th>
                              <th>Verified</th>
                              <th>Receipt</th>
                            </tr>
                          </thead>
                          <tbody>
                            {f.transactions.map((t) => (
                              <tr key={t.created_at + t.amount}>
                                <td>{t.created_at ? new Date(t.created_at).toLocaleDateString("en-PK") : "—"}</td>
                                <td className="fee__payments-table-amount">Rs {Number(t.amount || 0).toLocaleString()}</td>
                                <td>{t.payment_method}</td>
                                <td>{t.reference_number || "—"}</td>
                                <td>
                                  {t.recorded_by === "admin" ? (
                                    <span className="fee__verified-tag"><CheckCircle size={11} /> By Admin</span>
                                  ) : "—"}
                                </td>
                                <td>
                                  {t.proof_image_url ? (
                                    <button onClick={() => window.open(t.proof_image_url, "_blank")} className="fee__view-receipt">View</button>
                                  ) : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {!isPaid && (
                    <div className="fee__pay-section">
                      <button
                        className="fee__pay-btn"
                        onClick={() => { setShowMethods(showMethods === f.id ? null : f.id); setShowProofForm(null); setUploadSuccess(false); }}
                      >
                        Pay Now {showMethods === f.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>

                      {showMethods === f.id && (
                        <div className="fee__methods">
                          <div className="fee__accounts-grid">
                            {COLLEGE_ACCOUNTS.map((acc) => (
                              <div key={acc.method} className="fee__account-card">
                                <div className="fee__account-header">
                                  <span>{acc.icon} {acc.method}</span>
                                </div>
                                {acc.details.map((d) => (
                                  <div key={d.label} className="fee__account-row">
                                    <span className="fee__account-label">{d.label}</span>
                                    <span className="fee__account-value">{d.value}</span>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>

                          <div className="fee__instructions">
                            <p>📌 <strong>Instructions:</strong></p>
                            <ol>
                              <li>Transfer fee to any of the above accounts</li>
                              <li>Take a screenshot or photo of the receipt</li>
                              <li>Click "Upload Payment Proof" below</li>
                              <li>Admin will verify within 24-48 hours</li>
                            </ol>
                          </div>

                          <button
                            className="fee__upload-proof-btn"
                            onClick={() => setShowProofForm(showProofForm === f.id ? null : f.id)}
                          >
                            <Upload size={15} /> Upload Payment Proof
                          </button>

                          {showProofForm === f.id && (
                            <div className="fee__proof-form">
                              <div className="fee__proof-grid">
                                <div className="fee__proof-field">
                                  <label>Payment Method Used</label>
                                  <select value={selectedMethod} onChange={(e) => setSelectedMethod(e.target.value)}>
                                    <option>Easypaisa</option>
                                    <option>Bank Al Habib</option>
                                    <option>Raast</option>
                                    <option>Cash in College Office</option>
                                  </select>
                                </div>
                                <div className="fee__proof-field">
                                  <label>{paymentReferenceLabel}</label>
                                  <input
                                    placeholder={paymentReferencePlaceholder}
                                    value={refNumber}
                                    onChange={(e) => setRefNumber(e.target.value)}
                                  />
                                </div>
                                <div className="fee__proof-field">
                                  <label>Amount Paid (Rs) *</label>
                                  <input
                                    type="number"
                                    placeholder={`e.g. ${f.amount_due}`}
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                  />
                                </div>
                              </div>
                              <div className="fee__proof-field">
                                <label>Payment Screenshot / Photo *</label>
                                <div className="fee__file-area" onClick={() => fileRef.current?.click()}>
                                  {proofFile ? (
                                    <p className="fee__file-name"><FileCheck size={14} /> {proofFile.name}</p>
                                  ) : (
                                    <p className="fee__file-placeholder"><Upload size={18} /> Click to select screenshot or photo</p>
                                  )}
                                </div>
                                <input
                                  type="file"
                                  accept="image/*,.pdf"
                                  ref={fileRef}
                                  onChange={(e) => setProofFile(e.target.files[0])}
                                  style={{ display: "none" }}
                                />
                              </div>
                              {uploadError && <p className="fee__upload-error">{uploadError}</p>}
                              <button
                                onClick={() => handleProofSubmit(f.id)}
                                disabled={uploading}
                                className="fee__submit-proof-btn"
                              >
                                {uploading ? "Submitting..." : "Submit Payment Proof"}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {f.status === "Pending Verification" && (
                    <div className="fee__pending-note">
                      ⏳ Your payment proof has been submitted and is under review. You will be notified once verified.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
