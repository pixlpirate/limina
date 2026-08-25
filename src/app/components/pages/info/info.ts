import { Location } from '@angular/common';
import {
	afterNextRender,
	ChangeDetectionStrategy,
	Component,
	computed,
	ElementRef,
	inject,
} from '@angular/core';
import { environment } from '@environments';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ToastService } from '@services';
import { MarkdownComponent } from 'ngx-markdown';

import { Panel } from '../../molecules';

/** Where the app lives, and how to reach whoever wrote it */
const GITHUB = 'https://github.com/pixlpirate/limina';
const CONTACT = 'https://pixelpirate.fr/contact';

/** Prose lives beside the app as markdown, one file per section and language */
const CONTENT = 'content';

/** The language the files fall back to */
const FALLBACK = 'en';

/** Languages a markdown file has been written in */
const TRANSLATED = ['en', 'fr', 'es', 'it', 'de', 'pt', 'el', 'sv', 'nl'];

/** A tool the app leans on. Names and links read the same in every language. */
interface Tool {
	key: string;
	name: string;
	url: string;
	/** Carried only where the terms ask for it to be shown */
	credit?: string;
}

const TOOLS: Tool[] = [
	{
		key: 'mapterhorn',
		name: 'Mapterhorn',
		url: 'https://mapterhorn.com',
		credit: '© Mapterhorn',
	},
	{
		key: 'openstreetmap',
		name: 'OpenStreetMap',
		url: 'https://www.openstreetmap.org/copyright',
		credit: '© OpenStreetMap contributors',
	},
	{ key: 'carto', name: 'CARTO', url: 'https://carto.com/attributions', credit: '© CARTO' },
	{ key: 'nominatim', name: 'Nominatim', url: 'https://nominatim.org' },
	{ key: 'maplibre', name: 'MapLibre GL', url: 'https://maplibre.org' },
	{
		key: 'milkyWay',
		name: 'Milky Way Outline Catalog',
		url: 'https://github.com/ofrohn/d3-celestial',
	},
];

/** What the app is, what it is built on, and what has changed */
@Component({
	selector: 'app-info',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [MarkdownComponent, Panel, TranslatePipe],
	templateUrl: './info.html',
	styleUrl: './info.scss',
})
export class Info {
	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
	private readonly translate = inject(TranslateService);
	private readonly toast = inject(ToastService);
	private readonly location = inject(Location);

	protected readonly github = GITHUB;
	protected readonly contact = CONTACT;
	protected readonly version = environment.version;
	protected readonly tools = TOOLS;

	constructor() {
		// The tools heading has no markdown to wait on.
		afterNextRender(() => this.anchorHeadings());
	}

	protected readonly description = computed(() => this.file('description'));
	protected readonly changelog = computed(() => this.file('changelog'));

	/**
	 * Gives every heading an id and a link to itself, once the markdown is on the
	 * page. Markdown cannot carry the button, and putting one in by hand would
	 * mean writing HTML in the very files this is meant to keep clean.
	 */
	protected anchorHeadings(): void {
		const label = this.translate.instant('info.copyLink') as string;
		const headings = this.host.nativeElement.querySelectorAll<HTMLElement>(
			'.info__prose :is(h1, h2, h3, h4, h5, h6)',
		);

		for (const heading of headings) {
			if (heading.querySelector('.info__anchor')) {
				continue;
			}

			heading.id ||= slug(heading.textContent ?? '');
			heading.classList.add('info__anchored');

			// The icon hangs off the end of the words rather than off the heading
			// box, so it needs something wrapped round them to measure from.
			const text = document.createElement('span');
			text.className = 'info__heading-text';
			while (heading.firstChild) {
				text.append(heading.firstChild);
			}

			const link = document.createElement('a');
			link.className = 'info__anchor';
			link.href = `#${heading.id}`;
			link.setAttribute('aria-label', label);
			link.innerHTML = '<i class="icon-link" aria-hidden="true"></i>';

			text.append(link);
			heading.append(text);

			// The whole heading answers, not just the icon — but a link inside one
			// is still its own link, and goes where it says.
			heading.addEventListener('click', (event) => {
				const clicked = event.target as HTMLElement;
				if (clicked.closest('a') && !clicked.closest('.info__anchor')) {
					return;
				}
				void this.link(heading.id, event);
			});
		}
	}

	/**
	 * Goes to a heading and puts it in the address bar, without leaving a step in
	 * the history for the back button to walk through. The link is copied too, so
	 * one press is enough to send someone to this exact part of the page.
	 */
	protected async link(id: string, event: Event): Promise<void> {
		event.preventDefault();

		this.host.nativeElement
			.querySelector(`#${CSS.escape(id)}`)
			?.scrollIntoView({ behavior: 'smooth', block: 'start' });

		// Through Angular's Location, so the router's idea of where we are keeps up.
		this.location.replaceState(`${this.location.path(false).split('#')[0]}#${id}`);

		try {
			await navigator.clipboard.writeText(`${globalThis.location.href.split('#')[0]}#${id}`);
			this.toast.show(this.translate.instant('info.copied'), { status: 'success' });
		} catch {
			// A browser that will not reach the clipboard is nothing to report.
		}
	}

	/** The section in the viewer's language, or in English where it has none yet */
	private file(section: string): string {
		const language = this.translate.currentLang() ?? FALLBACK;
		const spoken = TRANSLATED.includes(language) ? language : FALLBACK;
		return `${CONTENT}/${section}.${spoken}.md`;
	}
}

/** A heading's own text, turned into something that can sit in a URL */
function slug(text: string): string {
	return (
		text
			.toLowerCase()
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'section'
	);
}
