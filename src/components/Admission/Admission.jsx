import { PROGRAMS } from "../../lib/academics";
import "./Admission.css";

// Built from the same list the admission form offers, so this sentence cannot
// name a programme the applicant then finds missing from the form.
const PROGRAM_LIST =
  PROGRAMS.length > 1
    ? `${PROGRAMS.slice(0, -1).join(", ")} and ${PROGRAMS[PROGRAMS.length - 1]}`
    : PROGRAMS[0];

export default function Admission({ onAdmissionClick }) {
  return (
    <section id="admission" className="admission">
      <div className="admission__container">
        <h2 className="admission__heading">Online Admission 2026</h2>
        <p className="admission__subheading">
          Applications are now open for {PROGRAM_LIST}.<br />
          Fill out the online form and submit your documents easily.
        </p>
        <button className="admission__cta" onClick={onAdmissionClick}>
          Apply for Admission →
        </button>
      </div>
    </section>
  );
}
