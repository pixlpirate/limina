import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Bookmark } from '@interfaces';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CoordinatePipe, LengthPipe } from '@pipes';
import {
	BookmarksService,
	MenuService,
	ModalService,
	ToastService,
	ViewpointService,
} from '@services';

import { Panel, Table, TableColumn } from '../../../molecules';

@Component({
	selector: 'app-viewpoint-bookmarks',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [Panel, Table, TranslatePipe],
	providers: [CoordinatePipe, LengthPipe],
	styleUrl: './bookmarks.scss',
	templateUrl: './bookmarks.html',
})
export class ViewpointBookmarks {
	private readonly store = inject(BookmarksService);
	private readonly viewpoint = inject(ViewpointService);
	private readonly toast = inject(ToastService);
	private readonly modal = inject(ModalService);
	private readonly router = inject(Router);
	private readonly menu = inject(MenuService);
	private readonly coordinate = inject(CoordinatePipe);
	private readonly length = inject(LengthPipe);
	private readonly translate = inject(TranslateService);

	protected readonly bookmarks = this.store.bookmarks;

	protected readonly columns: TableColumn<Bookmark>[] = [
		{
			key: 'name',
			label: 'bookmarks.name',
			rowHeader: true,
			text: (bookmark) => bookmark.name,
		},
		{
			key: 'position',
			secondary: true,
			label: 'bookmarks.position',
			text: (bookmark) =>
				`${this.coordinate.transform(bookmark.lat, 'lat')} · ${this.coordinate.transform(bookmark.lon, 'lon')}`,
			value: (bookmark) => -bookmark.lat,
		},
		{
			key: 'altitude',
			secondary: true,
			label: 'bookmarks.altitude',
			text: (bookmark) => this.length.transform(bookmark.altitude),
			value: (bookmark) => bookmark.altitude,
		},
		{
			key: 'created',
			secondary: true,
			label: 'bookmarks.marked',
			text: (bookmark) => new Date(bookmark.created).toLocaleDateString(),
			value: (bookmark) => bookmark.created,
		},
	];

	/** Moves there and stands aside, since the point is to look at the place. */
	protected flyTo(bookmark: Bookmark): void {
		this.menu.forget();
		this.viewpoint.moveTo(bookmark, 'bookmark', bookmark.name);
		void this.router.navigate(['/']);
	}

	protected async remove(bookmark: Bookmark): Promise<void> {
		const agreed = await this.modal.confirm(
			'bookmarks.deleteMessage',
			{ name: bookmark.name },
			'modal.delete',
			'bookmarks.deleteTitle',
		);
		if (!agreed) {
			return;
		}

		this.store.remove(bookmark.id);
		this.toast.show(this.translate.instant('bookmarks.deleted', { name: bookmark.name }));
	}
}
