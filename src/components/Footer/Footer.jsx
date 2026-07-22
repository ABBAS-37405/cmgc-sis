import { MapPin, Phone, Mail, GraduationCap } from "lucide-react";
import "./Footer.css";

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="white">
      <path d="M22 12.06C22 6.48 17.52 2 12 2S2 6.48 2 12.06c0 5.02 3.66 9.18 8.44 9.93v-7.03H7.9v-2.9h2.54V9.41c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.87h2.78l-.45 2.9h-2.33V22c4.78-.75 8.44-4.91 8.44-9.94Z" />
    </svg>
  );
}

function YoutubeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="white">
      <path d="M10 9.5v5l4.5-2.5L10 9.5Z" />
      <path d="M21.6 7.2s-.2-1.5-.8-2.1c-.8-.8-1.7-.8-2.1-.9C15.9 4 12 4 12 4h0s-3.9 0-6.7.2c-.4 0-1.3.1-2.1.9-.6.6-.8 2.1-.8 2.1S2.2 9 2.2 10.8v1.4c0 1.8.2 3.6.2 3.6s.2 1.5.8 2.1c.8.8 1.8.8 2.3.9 1.6.2 6.5.2 6.5.2s3.9 0 6.7-.2c.4 0 1.3-.1 2.1-.9.6-.6.8-2.1.8-2.1s.2-1.8.2-3.6v-1.4c0-1.8-.2-3.6-.2-3.6Z" fillRule="evenodd" clipRule="evenodd" fillOpacity="0" stroke="white" strokeWidth="0" />
    </svg>
  );
}

function WhatsappIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="white">
      <path d="M20.52 3.48A11.86 11.86 0 0 0 12.04 0C5.46 0 .09 5.37.09 11.95c0 2.11.55 4.09 1.51 5.81L0 24l6.4-1.68a11.86 11.86 0 0 0 5.64 1.43h.01c6.58 0 11.95-5.37 11.95-11.95 0-3.19-1.24-6.19-3.48-8.32ZM12.05 21.3h-.01a9.3 9.3 0 0 1-4.74-1.3l-.34-.2-3.53.93.94-3.44-.22-.35a9.3 9.3 0 0 1-1.43-4.99c0-5.14 4.19-9.33 9.34-9.33 2.49 0 4.83.97 6.59 2.73a9.26 9.26 0 0 1 2.73 6.6c0 5.15-4.19 9.35-9.33 9.35Zm5.34-6.98c-.29-.15-1.72-.85-1.99-.94-.27-.1-.46-.15-.66.15-.2.29-.76.94-.93 1.13-.17.2-.34.22-.63.07-.29-.15-1.22-.45-2.33-1.44-.86-.77-1.44-1.72-1.61-2.01-.17-.29-.02-.45.13-.6.14-.14.3-.36.45-.54.15-.18.2-.31.3-.51.1-.2.05-.37-.03-.51-.08-.15-.6-1.46-.82-2-.22-.53-.44-.46-.6-.47-.16-.01-.34-.01-.52-.01-.18 0-.47.07-.72.34-.25.27-.96.94-.96 2.3 0 1.36.99 2.67 1.13 2.86.14.18 1.86 2.84 4.5 3.87 2.65 1.03 2.65.69 3.12.64.47-.05 1.5-.61 1.71-1.2.21-.59.21-1.1.15-1.2-.06-.1-.24-.16-.53-.31Z" />
    </svg>
  );
}

export default function Footer() {
  return (
    <footer id="contact" className="footer">
      <div className="footer__grid">
        <div>
          <div className="footer__brand">
            <span className="footer__logo"><GraduationCap size={16} /></span>
            <span>CMGC Rawalpindi</span>
          </div>
          <p className="footer__muted">Empowering girls through education since 2011.</p>
        </div>
        <div>
          <h4>Contact</h4>
          <p className="footer__muted"><MapPin size={14} /> Gulzar-e-Quaid, Rawalpindi</p>
          <p className="footer__muted"><Phone size={14} /> +92-51-5707822, 0333-5221914</p>
          <p className="footer__muted"><Mail size={14} /> cmgc.cv@gmail.com </p>
        </div>
        <div>
          <h4>Follow Us</h4>
          <div className="footer__socials">
  <a href="https://whatsapp.com/channel/0029VbDjYFW0AgWC2CSzPK1k" target="_blank" rel="noopener noreferrer" className="footer__social-btn footer__social-btn--whatsapp"><WhatsappIcon /></a>
  <a href="https://www.facebook.com/profile.php?id=100063488536059" target="_blank" rel="noopener noreferrer" className="footer__social-btn footer__social-btn--facebook"><FacebookIcon /></a>
  <a href="https://www.youtube.com/channel/UCd3cWXQn_0k8XpOLgsPabTw" target="_blank" rel="noopener noreferrer" className="footer__social-btn footer__social-btn--youtube"><YoutubeIcon /></a>
</div>
        </div>
      </div>
      <p className="footer__copyright">© 2026 Community Model Girls College. All rights reserved.</p>
    </footer>
  );
}