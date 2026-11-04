// Why a post or edit was not published, for the post and edit forms. A held post gets a short reason and a link to Support.
import { holdFeedbackText, type PostFeedback } from '../lib/posts/feedback.ts';

export function PostFeedbackText({ feedback, title }: { feedback: PostFeedback; title?: string }) {
	if (feedback.code === 'moderation_review_needed') {
		return <p>{holdFeedbackText(feedback)} <a href="/support" target="_blank" rel="noopener noreferrer">Contact Support</a></p>;
	}
	return <>{title && <strong>{title}</strong>}<p>{feedback.message}</p><p>{feedback.fix}</p></>;
}
