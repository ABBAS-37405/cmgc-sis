import { useState, useEffect } from "react";
import { BookOpen, Play, ExternalLink, Download, ListVideo, X } from "lucide-react";
import {
  LMS_CATEGORIES, categoryLabel, fetchMaterialsForStudent,
  parseYouTube, youTubeEmbedUrl, youTubeWatchUrl, isPlaylist,
} from "../../lib/lms";
import "./Lms.css";

const when = (iso) =>
  new Date(iso).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });

/**
 * What her teachers have published for her subjects — lectures, papers,
 * schemes, notes and links, grouped by subject and then by kind.
 *
 * Read-only by design: a student never uploads here. Anything she needs to send
 * back goes through the Assignments tab.
 */
export default function Lms({ student }) {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetchMaterialsForStudent(student).then((rows) => {
      if (cancelled) return;
      setMaterials(rows);
      setLoading(false);
    });
    return () => { cancelled = true; };
    // Keyed on the three fields the query actually uses, not the whole object —
    // a fresh `student` reference each render would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id, student?.program, student?.year_of_study]);

  // Only subjects that actually carry something — an empty tab per subject
  // would be noise.
  const subjects = [...new Set(materials.map((m) => m.subject))].sort();
  const active = subject && subjects.includes(subject) ? subject : subjects[0];
  const forSubject = materials.filter((m) => m.subject === active);

  if (loading) return <p className="lms__empty">Loading your course material...</p>;

  if (materials.length === 0) {
    return (
      <div className="lms">
        <Header student={student} />
        <div className="lms__empty lms__empty--box">
          <BookOpen size={30} />
          <p>Nothing has been published for your class yet.</p>
          <p className="lms__hint">
            Lectures, past papers, paper schemes and notes will appear here as your teachers upload them.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="lms">
      <Header student={student} />

      <div className="lms__subjects" role="tablist" aria-label="Subjects">
        {subjects.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={s === active}
            onClick={() => setSubject(s)}
            className={"lms__subject " + (s === active ? "lms__subject--active" : "")}
          >
            {s}
            <span className="lms__subject-count">{materials.filter((m) => m.subject === s).length}</span>
          </button>
        ))}
      </div>

      {/* Categories in the order LMS_CATEGORIES declares, so lectures lead and
          announcements trail, rather than whatever order rows came back in. */}
      {LMS_CATEGORIES.map((cat) => {
        const items = forSubject.filter((m) => m.category === cat.id);
        if (items.length === 0) return null;
        return (
          <section key={cat.id} className="lms__section">
            <h3>{cat.label}</h3>
            <div className="lms__items">
              {items.map((item) => <Material key={item.id} item={item} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Header({ student }) {
  return (
    <div className="lms__head">
      <h2><BookOpen size={20} /> Course Material</h2>
      <p>
        {student?.program}
        {student?.year_of_study ? ` · ${student.year_of_study}` : ""}
      </p>
    </div>
  );
}

function Material({ item }) {
  const [playing, setPlaying] = useState(false);
  const youtube = parseYouTube(item.link_url);

  return (
    <article className="lms__item">
      <div className="lms__item-head">
        <h4>{item.title}</h4>
        <span className="lms__when">{when(item.created_at)}</span>
      </div>

      {item.body && <p className="lms__body">{item.body}</p>}

      {/* A YouTube link plays in place; the same link also opens on YouTube for
          anyone who would rather watch it there, or save it. */}
      {youtube && (
        <div className="lms__video">
          {playing ? (
            <>
              <div className="lms__frame">
                <iframe
                  src={youTubeEmbedUrl(youtube)}
                  title={item.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  loading="lazy"
                />
              </div>
              <button className="lms__btn" onClick={() => setPlaying(false)}>
                <X size={14} /> Close player
              </button>
            </>
          ) : (
            <button className="lms__btn lms__btn--play" onClick={() => setPlaying(true)}>
              {isPlaylist(youtube) ? <ListVideo size={15} /> : <Play size={15} />}
              {isPlaylist(youtube) ? "Play playlist here" : "Play here"}
            </button>
          )}

          <a
            className="lms__btn"
            href={youTubeWatchUrl(youtube, item.link_url)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={14} /> Open on YouTube
          </a>
        </div>
      )}

      <div className="lms__actions">
        {item.link_url && !youtube && (
          <a className="lms__btn" href={item.link_url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} /> Open link
          </a>
        )}
        {item.file_url && (
          <a className="lms__btn" href={item.file_url} target="_blank" rel="noopener noreferrer">
            <Download size={14} /> {item.file_name || "Download file"}
          </a>
        )}
        {/* The file was swept to free storage, but the material was not deleted —
            everything above this line is still hers. Saying so is the point: a
            download button that has quietly vanished reads as a broken page. */}
        {!item.file_url && item.file_archived_at && (
          <p className="lms__archived">
            The attached file was removed to save space. Everything written above is still here —
            ask your teacher to upload the file again if you need it.
          </p>
        )}
      </div>

      <span className="lms__tag">{categoryLabel(item.category)}</span>
    </article>
  );
}
