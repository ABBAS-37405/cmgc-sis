import "./Programs.css";

const PROGRAMS = [
  { name: "FSc Pre-Medical", duration: "2 Years", subjects: "Biology, Chemistry, Physics, English" },
  { name: "FSc Pre-Engineering", duration: "2 Years", subjects: "Mathematics, Chemistry, Physics, English" },
  { name: "FA (Humanities)", duration: "2 Years", subjects: "Economics, Education, Civics, English" },
  { name: "ICS", duration: "2 Years", subjects: "Computer Science, Mathematics, Physics" },
  { name: "ICOM", duration: "2 Years", subjects: "Accounting, Business, Economics" },
];

export default function Programs() {
  return (
    <section id="programs" className="programs">
      <div className="programs__container">
        <h2 className="programs__heading">Programs Offered</h2>
        <div className="programs__grid">
          {PROGRAMS.map((p) => (
            <div key={p.name} className="programs__card">
              <h3>{p.name}</h3>
              <p className="programs__duration">{p.duration}</p>
              <p className="programs__subjects">{p.subjects}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}