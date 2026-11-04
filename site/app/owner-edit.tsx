// The Edit button, on the signed-in person's own posts. A server component, so only the owner's post bodies reach
// the client-side editor.
import type { Post } from '#lib/posts/comments.ts';
import { EditPost } from './edit-post.tsx';

export const OwnerEdit = ({ post, owner }: { post: Post; owner: string }) =>
	owner === post.voter ? <EditPost key={owner} id={post.id} owner={owner} body={post.body} revision={post.revision} /> : null;
