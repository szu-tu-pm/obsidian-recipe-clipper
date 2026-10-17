import { useId, useState } from "react";
import {
	AVAILABILITY_LABELS,
	applyPantryEdit,
	createManualShoppingItem,
	itemAccessibleName,
	nextAvailabilityStatus,
	pantryDisplay,
	type ShoppingListDocument,
	type ShoppingListItem,
} from "../domain/schema/shoppingListSchema";
import { useEscapeToClose } from "./useEscapeToClose";

export function ShoppingListView({
	list,
	refreshDisabled = false,
	onEdit,
	onCommit,
	onFlush,
	onRefresh,
	onClose,
}: {
	list: ShoppingListDocument;
	refreshDisabled?: boolean;
	onEdit: (list: ShoppingListDocument) => void;
	onCommit: (list: ShoppingListDocument) => void;
	onFlush: () => void;
	onRefresh: () => void;
	onClose: () => void;
}): JSX.Element {
	const titleId = useId();
	const [neededOnly, setNeededOnly] = useState(false);
	const [draftName, setDraftName] = useState("");
	const [draftQuantity, setDraftQuantity] = useState("");
	const [draftUnit, setDraftUnit] = useState("");
	useEscapeToClose(onClose);

	const visible = list.frontmatter.items.filter(
		(item) => !neededOnly || item.status === "need" || item.status === "partial",
	);

	function commit(items: ShoppingListItem[], immediate: boolean): void {
		const next = {
			...list,
			frontmatter: {
				...list.frontmatter,
				items,
			},
		};
		if (immediate) {
			onCommit(next);
			return;
		}
		onEdit(next);
	}

	function updateItem(
		item: ShoppingListItem,
		patch: Parameters<typeof applyPantryEdit>[1],
		immediate = false,
	): void {
		commit(
			list.frontmatter.items.map((candidate) =>
				candidate.id === item.id ? applyPantryEdit(candidate, patch) : candidate,
			),
			immediate,
		);
	}

	function addItem(): void {
		const name = draftName.trim();
		if (!name) {
			return;
		}
		const quantityText = draftQuantity.trim();
		const quantity = quantityText === "" ? null : Number(quantityText);
		if (quantityText !== "" && (quantity == null || !Number.isFinite(quantity) || quantity < 0)) {
			return;
		}
		commit(
			[
				...list.frontmatter.items,
				createManualShoppingItem(name, quantity, draftUnit.trim() || null),
			],
			true,
		);
		setDraftName("");
		setDraftQuantity("");
		setDraftUnit("");
	}

	return (
		<div className="recipe-clipper-modal-backdrop" role="presentation">
			<div
				className="recipe-clipper-modal recipe-clipper-modal-wide"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
			>
				<header className="recipe-clipper-collection-header">
					<h3 id={titleId}>{list.frontmatter.title}</h3>
					<div className="recipe-clipper-row-actions">
						<button
							type="button"
							aria-label="Refresh shopping list"
							disabled={refreshDisabled}
							title={
								refreshDisabled
									? "Select recipes to refresh this list"
									: "Refresh this list from the selected recipes"
							}
							onClick={onRefresh}
						>
							Refresh
						</button>
						<button type="button" onClick={onClose}>
							Close
						</button>
					</div>
				</header>
				<p className="recipe-clipper-hint">
					Availability is saved on this list. Editing or deleting a recipe does not change it.
				</p>
				<label className="recipe-clipper-inline-check">
					<input
						type="checkbox"
						checked={neededOnly}
						onChange={(event) => setNeededOnly(event.target.checked)}
					/>
					Needed only
				</label>
				{visible.length === 0 ? (
					<p className="recipe-clipper-empty">No items need to be bought.</p>
				) : (
					<ul className="recipe-clipper-shopping-list">
						{visible.map((item) => (
							<ShoppingListRow
								key={item.id}
								item={item}
								onEdit={(patch) => updateItem(item, patch)}
								onCommit={(patch) => updateItem(item, patch, true)}
								onFlush={onFlush}
								onDelete={() =>
									commit(
										list.frontmatter.items.filter((candidate) => candidate.id !== item.id),
										true,
									)
								}
							/>
						))}
					</ul>
				)}
				<form
					className="recipe-clipper-editor-row"
					onSubmit={(event) => {
						event.preventDefault();
						addItem();
					}}
				>
					<label>
						New item
						<input
							value={draftName}
							onChange={(event) => setDraftName(event.target.value)}
							placeholder="Item name"
						/>
					</label>
					<label>
						Quantity
						<input
							type="number"
							min="0"
							step="any"
							value={draftQuantity}
							onChange={(event) => setDraftQuantity(event.target.value)}
						/>
					</label>
					<label>
						Unit
						<input
							value={draftUnit}
							onChange={(event) => setDraftUnit(event.target.value)}
							placeholder="cup, g, tsp"
						/>
					</label>
					<button type="submit">Add item</button>
				</form>
			</div>
		</div>
	);
}

function ShoppingListRow({
	item,
	onEdit,
	onCommit,
	onFlush,
	onDelete,
}: {
	item: ShoppingListItem;
	onEdit: (patch: Parameters<typeof applyPantryEdit>[1]) => void;
	onCommit: (patch: Parameters<typeof applyPantryEdit>[1]) => void;
	onFlush: () => void;
	onDelete: () => void;
}): JSX.Element {
	const [nameDraft, setNameDraft] = useState(item.name);
	const label = itemAccessibleName(item);
	const availability = pantryDisplay(item);
	const statusLabel = AVAILABILITY_LABELS[item.status];
	return (
		<li className="recipe-clipper-shopping-item" aria-label={label}>
			<div className="recipe-clipper-editor-row">
				<label>
					Name
					<input
						aria-label={`Name for ${label}`}
						value={nameDraft}
						onChange={(event) => {
							const value = event.target.value;
							setNameDraft(value);
							if (value.trim()) {
								onEdit({ name: value });
							}
						}}
						onBlur={(event) => {
							if (!event.currentTarget.value.trim()) {
								setNameDraft(item.name);
							}
							onFlush();
						}}
					/>
				</label>
				<label>
					Required quantity
					<input
						aria-label={`Required quantity for ${label}`}
						type="number"
						min="0"
						step="any"
						value={item.requiredQuantity ?? ""}
						onChange={(event) =>
							onEdit({ requiredQuantity: numberOrNull(event.target.value) })
						}
						onBlur={onFlush}
					/>
				</label>
				<label>
					Required unit
					<input
						aria-label={`Required unit for ${label}`}
						value={item.requiredUnit ?? ""}
						onChange={(event) => onEdit({ requiredUnit: event.target.value || null })}
						onBlur={onFlush}
					/>
				</label>
			</div>
			<div className="recipe-clipper-editor-row">
				<button
					type="button"
					aria-label={`${label}: ${statusLabel}`}
					onClick={() => onCommit({ status: nextAvailabilityStatus(item.status) })}
				>
					{statusLabel}
				</button>
				<label>
					On hand quantity
					<input
						aria-label={`On hand quantity for ${label}`}
						type="number"
						min="0"
						step="any"
						value={item.ownedQuantity ?? ""}
						onChange={(event) => onEdit({ ownedQuantity: numberOrNull(event.target.value) })}
						onBlur={onFlush}
					/>
				</label>
				<label>
					On hand unit
					<input
						aria-label={`On hand unit for ${label}`}
						value={item.ownedUnit ?? ""}
						onChange={(event) => onEdit({ ownedUnit: event.target.value || null })}
						onBlur={onFlush}
					/>
				</label>
				<button type="button" onClick={onDelete}>
					Delete {item.name}
				</button>
			</div>
			<p className="recipe-clipper-availability">
				{availability.mode === "remaining" ? <span>{availability.text}</span> : null}
				{availability.mode === "required-only" ? <span>{availability.text}</span> : null}
				{availability.mode === "separate" ? (
					<>
						<span>{availability.requiredText}</span>
						<span>{availability.ownedText}</span>
					</>
				) : null}
			</p>
			{item.preparation ? <p className="recipe-clipper-hint">{item.preparation}</p> : null}
			<p className="recipe-clipper-hint">
				{item.mergeRuleId}: {item.mergeReason}
			</p>
			{item.sourceRefs.length > 0 ? (
				<ul className="recipe-clipper-source-badges" aria-label={`Sources for ${label}`}>
					{item.sourceRefs.map((ref) => (
						<li key={`${ref.recipeId}:${ref.ingredientId}`} className="recipe-clipper-source-badge">
							{ref.recipeTitle || ref.recipeId}
						</li>
					))}
				</ul>
			) : (
				<p className="recipe-clipper-hint">Manual item</p>
			)}
		</li>
	);
}

function numberOrNull(value: string): number | null {
	if (value.trim() === "") {
		return null;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		return null;
	}
	return parsed;
}

export function RegenerateListDialog({
	onCancel,
	onCreateNew,
	onReplace,
}: {
	onCancel: () => void;
	onCreateNew: () => void;
	onReplace: () => void;
}): JSX.Element {
	const headingId = useId();
	useEscapeToClose(onCancel);

	return (
		<div className="recipe-clipper-modal-backdrop" role="presentation" onClick={onCancel}>
			<div
				className="recipe-clipper-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby={headingId}
				onClick={(event) => event.stopPropagation()}
			>
				<h3 id={headingId}>Replace this shopping list?</h3>
				<p>
					Create a new list to keep this one, or replace it and clear the current availability
					edits.
				</p>
				<div className="recipe-clipper-modal-actions">
					<button type="button" onClick={onCancel}>
						Cancel
					</button>
					<button type="button" className="mod-cta" onClick={onCreateNew}>
						Create new list
					</button>
					<button type="button" className="mod-warning" onClick={onReplace}>
						Replace this list
					</button>
				</div>
			</div>
		</div>
	);
}
