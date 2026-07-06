import "./Admission.css";

export default function Admission({ onAdmissionClick }) {
  return (
    <section id="admission" className="admission">
      <div className="admission__container">
        <h2 className="admission__heading">Online Admission 2026</h2>
        <p className="admission__subheading">
          Applications are now open for FSc, FA, ICS, and ICOM programs.<br />
          Fill out the online form and submit your documents easily.
        </p>
        <button className="admission__cta" onClick={onAdmissionClick}>
          Apply for Admission →
        </button>
      </div>
    </section>
  );
}