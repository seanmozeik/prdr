import skillMarkdown from '../../skills/prdr/SKILL.md' with { type: 'text' };

export const printSkill = (): void => {
  process.stdout.write(skillMarkdown.endsWith('\n') ? skillMarkdown : `${skillMarkdown}\n`);
};
