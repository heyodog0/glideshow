/* The public pages: glideshow.org for someone signed out (what it is, and sign-in), the privacy policy and the terms.
   Google shows its "Continue with Google" to everyone only for an app whose home page, privacy policy and terms are
   public, so these three are the only pages readable without signing in (and the only ones robots.txt opens). */

import { page, esc } from './auth.js';

const CONTACT = 'heyodogo@gmail.com';
const foot = '<small><a href="/">Glideshow</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="https://github.com/heyodog0/glideshow">GitHub</a></small>';

export function landing() {
  return page('Glideshow', `<p class="tag">Slides you own, <em>gliding</em> where you work.</p>
<p>Glideshow is a slide editor whose decks are plain HTML files that you keep: in a folder on your computer, this browser, your Google Drive or a
GitHub repo. You see every version, and AI agents can read and edit them with you. Share a deck with a link, or only with the people you name, and they can comment on it.</p>
<a class="btn primary" href="/start">Start a deck</a><a class="btn" href="/login">Sign in</a>
<button class="btn" id="use-folder" type="button" hidden>Use a folder on this computer</button>
<small id="use-folder-note" hidden>Your decks as real folders you pick, only on this computer: not synced, and they can't be shared.</small>
<script>{   // Chrome and Edge on a computer can keep the decks in a folder the person picks (editor/lib/store-folder.js);
  // the others can't, and on a phone or tablet (a touch screen, no mouse) there is no folder to speak of
  const b = document.getElementById('use-folder');
  if ('showDirectoryPicker' in window && matchMedia('(pointer: fine)').matches) { b.hidden = false; document.getElementById('use-folder-note').hidden = false; }
  b.onclick = async () => {
    let dir; try { dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'glideshow' }); } catch { return; }   // closed without picking
    await (await import('/editor/lib/store-folder.js')).setFolder(dir);
    location.href = '/start';
  };
}</script>
<small>No account needed: your decks stay in this browser. Sign in with Google or GitHub to keep them in your Drive or a repo,
and to share them. Glideshow is free and in early testing.</small>${foot}`);
}

export function privacy() {
  return page('Privacy policy', `<small>Last updated October 12, 2026</small>
<p><b>What Glideshow keeps.</b> When you sign in with GitHub: your GitHub user id, username and name. When you sign in with Google: your
Google account id, name and email address. These go into a signed cookie in your browser (your session, for up to 90 days), not into a
database of users. For someone who keeps decks here, Glideshow also remembers which GitHub repo holds them and their recently opened decks.
Signing in with GitHub also gives Glideshow a GitHub token, good for 8 hours, which it uses only to list the repos you install it on while
you set up; it's deleted once you've chosen one, or when it expires.</p>
<p><b>Your decks.</b> Decks live where their owner keeps them: in a GitHub repo, which Glideshow reads and writes through its GitHub App,
only in the repos the owner installed it on; or in a <b>Glideshow</b> folder in the owner's Google Drive, where Glideshow has Google's
<code>drive.file</code> access: it can see and change only the files it created, nothing else in your Drive. To save while you're away, it
keeps a Google access token for that, which you can withdraw anytime at myaccount.google.com/permissions. Unsaved changes wait briefly on
Glideshow's servers (Cloudflare) and are then written to your repo or Drive. Decks made without an account (Start a deck) stay in your
browser's own storage on your device and never reach Glideshow's servers; Glideshow sends only its own pages and code to your browser.</p>
<p><b>Sharing and comments.</b> A deck's owner decides who can open it (anyone with the link, or the email addresses and GitHub usernames
they list). If you comment on a shared deck, your comment, your name and your email address or GitHub username are saved with the deck in its
owner's repo or Drive, where the owner (and anyone with access to it) can see them. Other people opening the deck see commenters' names only.</p>
<p><b>Reports.</b> If you report a shared deck, Glideshow keeps the report with your IP address and, if you give it, your email address, so
the person running Glideshow can review it; reports are deleted once dealt with.</p>
<p><b>What Glideshow doesn't do.</b> No ads, no tracking or analytics cookies, no selling or sharing of your information, and no use of your
decks or comments to train AI models. Search engines and AI crawlers are asked to stay out (robots.txt and noindex, noai headers).</p>
<p><b>Google user data.</b> Glideshow's use and transfer of information received from Google APIs adheres to the
<a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use
requirements: it is used only to sign you in and to keep your decks in your Drive, never for ads, never sold, and never read by people except
to keep the service secure or at your request.</p>
<p><b>Services used.</b> Cloudflare hosts Glideshow and keeps routine request logs (including IP addresses), and Glideshow's own error logs,
for a few days; GitHub holds the decks; Google and GitHub handle sign-in.
Their own privacy policies apply to them.</p>
<p><b>Your choices.</b> Sign out anytime; remove the Glideshow app from your GitHub account (Settings → Applications) to cut its access to your
repos; ask a deck's owner to delete your comments, or delete them yourself. Questions or deletion requests: <a href="mailto:${CONTACT}">${esc(CONTACT)}</a>.</p>${foot}`);
}

export function terms() {
  return page('Terms of service', `<small>Last updated October 12, 2026</small>
<p><b>Using Glideshow.</b> Glideshow is a free slide editor in early testing, provided as is, without warranties of any kind. It may change, be
interrupted or stop. Keep your own copies of anything important. Decks you keep in a GitHub repo or Google Drive are already your own files;
decks made without an account live only in your browser, which can clear them, so download them (File → Download) or sign in to keep them.</p>
<p><b>Your content.</b> Your decks and comments stay yours. You give Glideshow only the permission it needs to store, show and share them as you
ask. Don't use Glideshow for anything unlawful, to harm others, to share what you have no right to share, or to get around its limits or
anyone's access controls.</p>
<p><b>Sharing.</b> You decide who can open what you share and are responsible for that choice. A link set to "anyone with the link" can be
opened by anyone who has it.</p>
<p><b>Reports and takedowns.</b> Anyone can report a shared deck. A shared deck that breaks these terms (phishing, malware, illegal content,
harassment, or someone else's work you have no right to share) can be taken down, and its owner's account suspended.</p>
<p><b>Limits.</b> Files up to 25 MB each, up to 500 shared decks per library and 2,000 comments per deck, and a cap on how many changes
can be made per minute.</p>
<p><b>Accounts.</b> Access can be suspended for misuse. You can stop using Glideshow at any time by signing out and removing its GitHub app.</p>
<p><b>Liability.</b> To the extent the law allows, Glideshow and the person running it are not liable for any indirect or consequential loss,
or loss of data, from using it.</p>
<p>Contact: <a href="mailto:${CONTACT}">${esc(CONTACT)}</a>.</p>${foot}`);
}

export const robots = 'User-agent: *\nAllow: /$\nAllow: /privacy\nAllow: /terms\nDisallow: /\n';
