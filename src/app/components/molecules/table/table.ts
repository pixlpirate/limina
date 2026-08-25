import { NgTemplateOutlet } from '@angular/common';
import {
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	TemplateRef,
	computed,
	contentChild,
	effect,
	input,
	linkedSignal,
	output,
	signal,
	viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** A column, and how to read it from a row */
export interface TableColumn<T> {
	/** Identifies the column when sorting */
	key: string;
	/** Translation key for the heading */
	label: string;
	/** What the cell shows */
	text: (row: T) => string;
	/** Quieter second line under the cell */
	detail?: (row: T) => string;
	/**
	 * A colour to show beside the cell, where the row stands for something the eye already knows
	 * by its colour.
	 */
	swatch?: (row: T) => string;
	/** Sort and search key, where the text will not do */
	value?: (row: T) => string | number;
	/** Whether the column can be ordered */
	sortable?: boolean;
	/** Renders as the row header */
	rowHeader?: boolean;
	/**
	 * Dropped on a narrow screen. A phone has room for what identifies a row and
	 * little else, so everything that merely qualifies it stands down.
	 */
	secondary?: boolean;
}

/** The one table in the app */
@Component({
	selector: 'app-table',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [NgTemplateOutlet, TranslatePipe],
	templateUrl: './table.html',
	styleUrl: './table.scss',
})
export class Table<T> {
	readonly columns = input.required<TableColumn<T>[]>();
	readonly rows = input.required<T[]>();
	readonly caption = input<string>();
	/** Adds a filter over every column */
	readonly searchable = input(false);
	/** Empty-state translation key */
	readonly emptyMessage = input('table.empty');
	/** Makes each row activate */
	readonly selectable = input(false);
	readonly rowSelect = output<T>();

	/**
	 * A button in a column of its own at the end of the row, for something acting
	 * on the row rather than following from its name. Always showing.
	 */
	protected readonly actions = contentChild<TemplateRef<{ $implicit: T }>>('actions');

	/** Buttons beside the row name */
	protected readonly rowActions = contentChild<TemplateRef<{ $implicit: T }>>('rowActions');

	protected readonly query = signal('');
	protected readonly searching = signal(false);

	private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

	constructor() {
		// The box is only in the DOM once the search is open, so this waits for it
		// to arrive rather than reaching for it as the button is pressed.
		effect(() => {
			if (this.searching()) {
				this.field()?.nativeElement.focus();
			}
		});
	}

	/** Column being ordered by */
	protected readonly sortKey = linkedSignal<TableColumn<T>[], string | null>({
		source: this.columns,
		computation: (columns, previous) =>
			previous?.value && columns.some((column) => column.key === previous.value)
				? previous.value
				: null,
	});
	protected readonly descending = signal(false);

	protected readonly visible = computed(() => {
		const columns = this.columns();
		const query = this.query().trim().toLowerCase();

		const matching = query
			? this.rows().filter((row) =>
					columns.some((column) => cell(column, row).toLowerCase().includes(query)),
				)
			: this.rows();

		const key = this.sortKey();
		const column = columns.find((item) => item.key === key);
		if (!column) {
			return matching;
		}

		const direction = this.descending() ? -1 : 1;
		return [...matching].sort(
			(a, b) => compare(sortable(column, a), sortable(column, b)) * direction,
		);
	});

	protected sortIcon(column: TableColumn<T>): string {
		if (this.sortKey() !== column.key) {
			return 'icon-chevron-sort';
		}
		return this.descending() ? 'icon-chevron-sort-down' : 'icon-chevron-sort-up';
	}

	/** Sort order, for screen readers */
	protected ariaSort(column: TableColumn<T>): 'ascending' | 'descending' | 'none' {
		if (this.sortKey() !== column.key) {
			return 'none';
		}
		return this.descending() ? 'descending' : 'ascending';
	}

	/** Cycles ascending, descending, then natural order */
	protected toggleSort(column: TableColumn<T>): void {
		if (this.sortKey() !== column.key) {
			this.sortKey.set(column.key);
			this.descending.set(false);
			return;
		}
		if (!this.descending()) {
			this.descending.set(true);
			return;
		}
		this.sortKey.set(null);
		this.descending.set(false);
	}

	protected toggleSearch(): void {
		this.searching.update((open) => !open);

		if (!this.searching()) {
			this.query.set('');
		}
	}

	protected text(column: TableColumn<T>, row: T): string {
		return column.text(row);
	}

	protected detail(column: TableColumn<T>, row: T): string {
		return column.detail?.(row) ?? '';
	}

	protected swatch(column: TableColumn<T>, row: T): string {
		return column.swatch?.(row) ?? '';
	}
}

/** Searchable text of one cell */
function cell<T>(column: TableColumn<T>, row: T): string {
	return `${column.text(row)} ${column.detail?.(row) ?? ''}`;
}

function sortable<T>(column: TableColumn<T>, row: T): string | number {
	return column.value ? column.value(row) : column.text(row);
}

function compare(a: string | number, b: string | number): number {
	if (typeof a === 'number' && typeof b === 'number') {
		return a - b;
	}
	return String(a).localeCompare(String(b));
}
