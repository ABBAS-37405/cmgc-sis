import { Wrench } from "lucide-react";
import "./WorkingOnIt.css";

export default function WorkingOnIt({ text }) {
  return (
    <div className="working-on-it">
      <Wrench size={12} />
      {text}
    </div>
  );
}