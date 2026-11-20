// A post's number, linking to the post alone as text: <thread>/<number>.txt. The number is the last part of the
// post's path (arxiv/2610.20058/481, forum/12/502), which is how the tools name it.
export const PostText = ({ thread, id }: { thread: string; id: number }) =>
	<a href={`${thread}/${id}.txt`} rel="alternate" type="text/plain" title="This post as text">#{id}</a>;
