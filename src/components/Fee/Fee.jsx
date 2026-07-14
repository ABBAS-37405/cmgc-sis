import { useState, useEffect, useRef } from "react";
import { CheckCircle, XCircle, ChevronDown, ChevronUp, Upload, FileCheck } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./Fee.css";

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

  useEffect(() => {
    if (studentId) fetchFees();
  }, [studentId]);

  const fetchFees = async () => {
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
        .select("fee_id, amount, status")
        .in("fee_id", feeIds)
        .eq("status", "Success");

      const paidByFeeId = (transactions || []).reduce((acc, txn) => {
        acc[txn.fee_id] = (acc[txn.fee_id] || 0) + Number(txn.amount || 0);
        return acc;
      }, {});

      const enrichedFees = feesData.map((fee) => {
        const paidAmount = Number(paidByFeeId[fee.id] || 0);
        const remainingAmount = Math.max(Number(fee.amount_due || 0) - paidAmount, 0);
        return { ...fee, amount_paid: paidAmount, remaining_amount: remainingAmount };
      });

      setFees(enrichedFees);
    } else {
      setFees([]);
    }

    setLoading(false);
  };

  const handleProofSubmit = async (feeId) => {
    setUploadError("");
    if (!proofFile) return setUploadError("Please select a screenshot or photo");
    if (!refNumber.trim()) return setUploadError(paymentReferenceError);
    if (!amount || isNaN(amount)) return setUploadError("Please enter amount paid");

    setUploading(true);

    // Upload proof to Supabase Storage
    const path = `payment-proofs/${Date.now()}-${proofFile.name}`;
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

  const statusBadge = (status) => {
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
        fees.map((f) => (
          <div key={f.id} className="fee__card">
            <div className="fee__header">
              <h3>{f.program} — Fee</h3>
              {statusBadge(f.status)}
            </div>
            <p className="fee__amount">Rs {Number(f.remaining_amount ?? f.amount_due ?? 0).toLocaleString()} to pay</p>
            {f.due_date && (
              <p className="fee__due">Due Date: {new Date(f.due_date).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" })}</p>
            )}
            {f.last_payment_date && (
              <p className="fee__due fee__due--paid">Paid on: {new Date(f.last_payment_date).toLocaleDateString("en-PK")}</p>
            )}

            {f.status !== "Paid" && Number(f.remaining_amount ?? 0) > 0 && (
              <div className="fee__pay-section">
                <button
                  className="fee__pay-btn"
                  onClick={() => { setShowMethods(showMethods === f.id ? null : f.id); setShowProofForm(null); setUploadSuccess(false); }}
                >
                  Pay Now {showMethods === f.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {showMethods === f.id && (
                  <div className="fee__methods">
                    {/* College Accounts */}
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

                    {/* Instructions */}
                    <div className="fee__instructions">
                      <p>📌 <strong>Instructions:</strong></p>
                      <ol>
                        <li>Transfer fee to any of the above accounts</li>
                        <li>Take a screenshot or photo of the receipt</li>
                        <li>Click "Upload Payment Proof" below</li>
                        <li>Admin will verify within 24-48 hours</li>
                      </ol>
                    </div>

                    {/* Upload Proof Button */}
                    <button
                      className="fee__upload-proof-btn"
                      onClick={() => setShowProofForm(showProofForm === f.id ? null : f.id)}
                    >
                      <Upload size={15} /> Upload Payment Proof
                    </button>

                    {/* Proof Upload Form */}
                    {showProofForm === f.id && (
                      <div className="fee__proof-form">
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
        ))
      )}
    </div>
  );
}