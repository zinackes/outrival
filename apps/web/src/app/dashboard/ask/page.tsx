import { AskPanel } from "@/components/dashboard/ask-panel";
import { WatchedQuestions } from "@/components/dashboard/watched-questions";

export default function AskPage() {
  return (
    <>
      <AskPanel />
      <div className="mx-auto mt-10 w-full max-w-3xl">
        <WatchedQuestions />
      </div>
    </>
  );
}
