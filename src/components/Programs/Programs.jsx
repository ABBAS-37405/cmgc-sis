import { PROGRAMS, GROUP_COMBINATIONS, compulsoryFor, groupHasChoice, formatCombination } from "../../lib/academics";
import "./Programs.css";

/**
 * Derived from the same group definitions the admission form uses, so the list a
 * visitor reads here can never drift from the groups she can actually apply for.
 * To add or change a programme, edit GROUP_COMBINATIONS in src/lib/academics.js.
 */
export default function Programs() {
  return (
    <section id="programs" className="programs">
      <div className="programs__container">
        <h2 className="programs__heading">Programs Offered</h2>

        <div className="programs__grid">
          {PROGRAMS.map((name) => {
            const combos = GROUP_COMBINATIONS[name];
            const hasChoice = groupHasChoice(name);

            return (
              <div key={name} className="programs__card">
                <h3>{name}</h3>
                <p className="programs__duration">
                  2 Years{hasChoice && <span className="programs__choice"> · choose 1 of {combos.length}</span>}
                </p>

                {hasChoice ? (
                  <ul className="programs__options">
                    {combos.map((combo, i) => (
                      <li key={formatCombination(combo)}>
                        <span className="programs__option-num">Option {i + 1}</span>
                        {formatCombination(combo)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="programs__subjects">{formatCombination(combos[0])}</p>
                )}
              </div>
            );
          })}
        </div>

        <p className="programs__note">
          {formatCombination(compulsoryFor("1st Year"))} are compulsory in every group in 1st year;
          in 2nd year Islamiat is replaced by Pakistan Studies.
        </p>
      </div>
    </section>
  );
}
