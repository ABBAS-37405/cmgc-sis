import { useState } from "react";
import { AlertCircle, ClipboardList, ChevronLeft } from "lucide-react";
import { PROGRAMS, subjectsForPrograms } from "../../lib/academics";
import { fetchTests, buildTestReport, testReportFileName } from "../../lib/testReport";
import { buildTestReportPdf, saveBlob } from "../../lib/reportPdf";
import { TestList, TestResultSheet } from "./TestResultSheet";

/**
 * Result sheets browsed by subject rather than by group/class.
 *
 * Test Reports narrows by "which group, which class" — right when you already
 * know a test's roster. This screen answers a different question: "every
 * Mathematics test, wherever it was set" — a subject coordinator's view rather
 * than a class teacher's. It is the same report underneath (`fetchTests` +
 * `buildTestReport`, two queries per test picked, none per subject listed), so
 * the sheet it prints can never disagree with the one Test Reports would print
 * for the same test.
 *
 * The subject list is `subjectsForPrograms(visiblePrograms)` — every subject
 * offered by the groups this admin can see, the same scoping every other admin
 * screen already applies.
 */
export default function SubjectReports({ allowedPrograms = [] }) {
  const isRestricted = allowedPrograms.length > 0;
  const visiblePrograms = isRestricted ? PROGRAMS.filter((p) => allowedPrograms.includes(p)) : PROGRAMS;
  const subjects = subjectsForPrograms(visiblePrograms);

  const [subject, setSubject] = useState(null);
  const [tests, setTests] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [report, setReport] = useState(null);

  const [loadingTests, setLoadingTests] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [building, setBuilding] = useState("");
  const [error, setError] = useState("");

  const openSubject = async (s) => {
    setSubject(s);
    setReport(null);
    setSelectedId("");
    setError("");
    setLoadingTests(true);
    try {
      setTests(await fetchTests({ allowedPrograms, subject: s }));
    } catch (e) {
      setError(e.message || "Could not load the tests.");
      setTests([]);
    }
    setLoadingTests(false);
  };

  const backToSubjects = () => {
    setSubject(null);
    setTests([]);
    setSelectedId("");
    setReport(null);
    setError("");
  };

  const openTest = async (test) => {
    setSelectedId(test.id);
    setLoadingReport(true);
    setError("");
    try {
      setReport(await buildTestReport(test, { allowedPrograms }));
    } catch (e) {
      setError(e.message || "Could not build the result sheet.");
      setReport(null);
    }
    setLoadingReport(false);
  };

  const download = async () => {
    if (!report) return;
    setBuilding("Preparing…");
    setError("");
    try {
      const blob = await buildTestReportPdf(report, {
        onProgress: (done, total) => setBuilding(`Student page ${done} of ${total}…`),
      });
      saveBlob(blob, testReportFileName(report));
    } catch (e) {
      setError(e.message || "Could not build the PDF.");
    }
    setBuilding("");
  };

  if (!subject) {
    return (
      <div className="mrep__pane">
        <p className="mrep__bar-label">
          Pick a subject — {subjects.length} offered across {isRestricted ? "your groups" : "the college"}.
        </p>
        <div className="mrep__tabs">
          {subjects.map((s) => (
            <button key={s} className="mrep__tab" onClick={() => openSubject(s)}>{s}</button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mrep__pane">
      <div className="mrep__bar">
        <button className="mrep__btn mrep__btn--sm" onClick={backToSubjects}>
          <ChevronLeft size={14} /> All subjects
        </button>
        <span className="mrep__bar-label">{subject}</span>
      </div>

      {error && <p className="mrep__error"><AlertCircle size={14} /> {error}</p>}

      {loadingTests ? (
        <p className="mrep__empty">Loading tests…</p>
      ) : tests.length === 0 ? (
        <div className="mrep__none">
          <ClipboardList size={28} />
          <p>No {subject} tests found.</p>
          <p className="mrep__none-hint">
            Tests appear here once a teacher (or an admin) has conducted one from the Class Tests screen.
          </p>
        </div>
      ) : (
        <>
          <p className="mrep__bar-label">
            {tests.length} {subject} test{tests.length === 1 ? "" : "s"} found, newest first.
          </p>
          <TestList tests={tests} selectedId={selectedId} onSelect={openTest} />
        </>
      )}

      {loadingReport && <p className="mrep__empty">Building the result sheet…</p>}

      {report && !loadingReport && (
        <TestResultSheet report={report} building={building} onDownload={download} />
      )}
    </div>
  );
}
