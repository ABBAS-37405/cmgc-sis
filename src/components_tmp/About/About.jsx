import "./About.css";

export default function About() {
  return (
    <section id="about" className="about">
      <div className="about__container">
        <h2 className="about__heading">About The College</h2>
        <p className="about__intro">
          Community Model Girls College (CMGC), located in Gulzar-e-Quaid, Rawalpindi, Punjab, has been committed to
          academic excellence for girls' education for over 15 years, proudly affiliated with BISE Rawalpindi.
        </p>
        <div className="about__grid">
          <div className="about__card">
            <h3>Our Mission</h3>
            <p>To provide quality education that empowers young women with knowledge, confidence, and the skills to shape their own futures.</p>
          </div>
          <div className="about__card about__card--principal">
            <div className="about__principal-photo-wrap">
              <div className="about__principal-ring"></div>
              <img src="/images/principal.jpg" alt="Principal" className="about__principal-photo" />
            </div>
            <h3>Principal's Message</h3>
            <p>"Every student who walks through our doors carries the potential to lead. Our goal is to nurture that potential every single day."</p>
          </div>
        </div>
      </div>
    </section>
  );
}