export function collectionState({ posts, errors }) {
  return {
    posts: Object.fromEntries(posts.map(({ id, revision }) => [id, revision])),
    errors: errors
      .map(({ file, message }) => ({ file, message }))
      .sort((a, b) => a.file.localeCompare(b.file)),
  };
}
