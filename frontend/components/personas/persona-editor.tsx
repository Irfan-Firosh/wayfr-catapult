"use client"

import { useCallback, useRef, useState } from "react"
import {
  Check,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type {
  AnnotationPriority,
  DerivedAnnotation,
  PersonaProfile,
} from "@/lib/persona-types"

// ── Priority helpers ──────────────────────────────────────────────────────────

const PRIORITY_OPTIONS: AnnotationPriority[] = ["critical", "high", "medium", "low"]

const PRIORITY_COLORS: Record<AnnotationPriority, string> = {
  critical: "#EF4444",
  high: "#F97316",
  medium: "#F5A623",
  low: "#6B7280",
}

const PRIORITY_LABELS: Record<AnnotationPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
}

function PriorityPill({ priority }: { priority: AnnotationPriority }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
      style={{
        backgroundColor: `${PRIORITY_COLORS[priority]}18`,
        color: PRIORITY_COLORS[priority],
        border: `1px solid ${PRIORITY_COLORS[priority]}30`,
      }}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  )
}

// ── Editable tag list ─────────────────────────────────────────────────────────

function TagList({
  tags,
  onRemove,
  onAdd,
  placeholder,
  accentColor,
}: {
  tags: string[]
  onRemove: (index: number) => void
  onAdd: (tag: string) => void
  placeholder: string
  accentColor?: string
}) {
  const [inputValue, setInputValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const handleAdd = useCallback(() => {
    const trimmed = inputValue.trim()
    if (trimmed && !tags.includes(trimmed)) {
      onAdd(trimmed)
      setInputValue("")
    }
  }, [inputValue, onAdd, tags])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault()
        handleAdd()
      }
    },
    [handleAdd]
  )

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="group inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
          style={{
            backgroundColor: accentColor ? `${accentColor}12` : undefined,
            borderColor: accentColor ? `${accentColor}30` : undefined,
            color: accentColor ?? undefined,
          }}
        >
          {tag}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="ml-0.5 rounded-full opacity-40 transition-opacity hover:opacity-100"
            aria-label={`Remove ${tag}`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <div className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/50 px-2.5 py-1 text-xs text-muted-foreground transition-colors focus-within:border-mango/50 focus-within:text-foreground">
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-[90px] bg-transparent outline-none placeholder:text-muted-foreground/50"
        />
        {inputValue.trim() && (
          <button type="button" onClick={handleAdd} className="shrink-0 text-mango">
            <Plus className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Derived annotation row ────────────────────────────────────────────────────

function DerivedAnnotationRow({
  annotation,
  index,
  onDelete,
  onUpdate,
  accentColor,
}: {
  annotation: DerivedAnnotation
  index: number
  onDelete: (index: number) => void
  onUpdate: (index: number, updated: DerivedAnnotation) => void
  accentColor: string
}) {
  const [editing, setEditing] = useState(false)
  const [draftLabel, setDraftLabel] = useState(annotation.label)
  const [draftDescription, setDraftDescription] = useState(annotation.description)
  const [draftPriority, setDraftPriority] = useState<AnnotationPriority>(annotation.priority)

  const handleSave = useCallback(() => {
    onUpdate(index, {
      ...annotation,
      label: draftLabel.trim() || annotation.label,
      description: draftDescription.trim() || annotation.description,
      priority: draftPriority,
    })
    setEditing(false)
  }, [annotation, draftLabel, draftDescription, draftPriority, index, onUpdate])

  const handleCancel = useCallback(() => {
    setDraftLabel(annotation.label)
    setDraftDescription(annotation.description)
    setDraftPriority(annotation.priority)
    setEditing(false)
  }, [annotation])

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5 transition-colors",
        editing ? "border-mango/30 bg-mango/5" : "border-border/40 bg-muted/10"
      )}
    >
      {editing ? (
        <div className="flex flex-col gap-2">
          <input
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            className="w-full rounded-lg border border-border/50 bg-background/60 px-2.5 py-1.5 text-xs font-semibold text-foreground outline-none focus:border-mango/50"
          />
          <textarea
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-lg border border-border/50 bg-background/60 px-2.5 py-1.5 text-xs text-muted-foreground outline-none focus:border-mango/50"
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Priority:</span>
            <div className="flex gap-1">
              {PRIORITY_OPTIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setDraftPriority(p)}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide border transition-all",
                    draftPriority === p ? "opacity-100" : "opacity-40 hover:opacity-70"
                  )}
                  style={{
                    backgroundColor: draftPriority === p ? `${PRIORITY_COLORS[p]}18` : "transparent",
                    borderColor: `${PRIORITY_COLORS[p]}40`,
                    color: PRIORITY_COLORS[p],
                  }}
                >
                  {PRIORITY_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleSave}
              className="flex items-center gap-1 rounded-lg bg-mango/15 px-2.5 py-1 text-[10px] font-medium text-mango hover:bg-mango/25 transition-colors"
            >
              <Check className="h-2.5 w-2.5" /> Save
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-lg px-2.5 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <div className="mt-0.5 h-full w-0.5 shrink-0 self-stretch rounded-full" style={{ backgroundColor: accentColor }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-foreground">{annotation.label}</span>
              <span className="text-[9px] text-muted-foreground/60">← {annotation.mappedFrom}</span>
              <PriorityPill priority={annotation.priority} />
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground leading-snug">{annotation.description}</p>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-lg p-1 text-muted-foreground/50 transition-colors hover:bg-muted/40 hover:text-foreground"
              aria-label="Edit"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(index)}
              className="rounded-lg p-1 text-muted-foreground/50 transition-colors hover:bg-red-500/10 hover:text-red-400"
              aria-label="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Color scheme swatch ───────────────────────────────────────────────────────

function ColorSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="h-7 w-7 rounded-full border-2 border-white/10 shadow-sm"
        style={{ backgroundColor: color }}
      />
      <span className="text-[9px] text-muted-foreground">{label}</span>
    </div>
  )
}

// ── Main editor ───────────────────────────────────────────────────────────────

interface PersonaEditorProps {
  persona: PersonaProfile
  onConfirm: (edited: PersonaProfile) => void
  onBack?: () => void
}

export function PersonaEditor({ persona, onConfirm, onBack }: PersonaEditorProps) {
  const [confirmed, setConfirmed] = useState(false)
  const [draft, setDraft] = useState<PersonaProfile>(() => ({ ...persona, primaryNeeds: [...persona.primaryNeeds], annotationFocus: [...persona.annotationFocus], derivedAnnotations: persona.derivedAnnotations.map((d) => ({ ...d })) }))
  const [roleEditing, setRoleEditing] = useState(false)
  const [draftRole, setDraftRole] = useState(persona.role)
  const [showDerived, setShowDerived] = useState(true)

  const handleRoleSave = useCallback(() => {
    setDraft((prev) => ({ ...prev, role: draftRole.trim() || prev.role }))
    setRoleEditing(false)
  }, [draftRole])

  const handleRemoveNeed = useCallback((index: number) => {
    setDraft((prev) => ({ ...prev, primaryNeeds: prev.primaryNeeds.filter((_, i) => i !== index) }))
  }, [])

  const handleAddNeed = useCallback((tag: string) => {
    setDraft((prev) => ({ ...prev, primaryNeeds: [...prev.primaryNeeds, tag] }))
  }, [])

  const handleRemoveFocus = useCallback((index: number) => {
    setDraft((prev) => ({ ...prev, annotationFocus: prev.annotationFocus.filter((_, i) => i !== index) }))
  }, [])

  const handleAddFocus = useCallback((tag: string) => {
    setDraft((prev) => ({ ...prev, annotationFocus: [...prev.annotationFocus, tag] }))
  }, [])

  const handleDeleteDerived = useCallback((index: number) => {
    setDraft((prev) => ({ ...prev, derivedAnnotations: prev.derivedAnnotations.filter((_, i) => i !== index) }))
  }, [])

  const handleUpdateDerived = useCallback((index: number, updated: DerivedAnnotation) => {
    setDraft((prev) => ({
      ...prev,
      derivedAnnotations: prev.derivedAnnotations.map((d, i) => (i === index ? updated : d)),
    }))
  }, [])

  const handleReset = useCallback(() => {
    setDraft({ ...persona, primaryNeeds: [...persona.primaryNeeds], annotationFocus: [...persona.annotationFocus], derivedAnnotations: persona.derivedAnnotations.map((d) => ({ ...d })) })
    setDraftRole(persona.role)
    setRoleEditing(false)
  }, [persona])

  const handleConfirm = useCallback(() => {
    setConfirmed(true)
    onConfirm({ ...draft, role: draftRole.trim() || draft.role })
  }, [draft, draftRole, onConfirm])

  const accentColor = draft.colorScheme.primary

  // ── Confirmed state ─────────────────────────────────────────────────────────

  if (confirmed) {
    return (
      <div className="overflow-hidden rounded-2xl border border-mango/20 bg-mango/5">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mango/15">
            <Check className="h-3 w-3 text-mango" />
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">Persona confirmed — {draft.role}</p>
            <p className="text-[10px] text-muted-foreground">
              {draft.annotationFocus.length} focus areas · {draft.derivedAnnotations.length} custom annotations
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Editor state ────────────────────────────────────────────────────────────

  return (
    <div className="overflow-hidden rounded-2xl border border-border/50 bg-background/50 backdrop-blur-sm">

      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: `1px solid ${accentColor}20` }}
      >
        <div className="flex items-center gap-2">
          <div
            className="flex h-6 w-6 items-center justify-center rounded-full"
            style={{ backgroundColor: `${accentColor}18` }}
          >
            <Sparkles className="h-3 w-3" style={{ color: accentColor }} />
          </div>
          <p className="text-sm font-semibold text-foreground">Review your persona</p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <RotateCcw className="h-2.5 w-2.5" />
          Reset
        </button>
      </div>

      <div className="flex flex-col gap-4 p-4">

        {/* Role */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Role</span>
          {roleEditing ? (
            <div className="flex gap-1.5">
              <input
                value={draftRole}
                onChange={(e) => setDraftRole(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRoleSave()}
                autoFocus
                className="flex-1 rounded-lg border border-mango/40 bg-background/70 px-2.5 py-1.5 text-sm font-semibold text-foreground outline-none focus:border-mango"
              />
              <button
                type="button"
                onClick={handleRoleSave}
                className="rounded-lg bg-mango/15 px-2.5 py-1.5 text-xs font-medium text-mango hover:bg-mango/25 transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setRoleEditing(true)}
              className="group flex items-center gap-2 text-left"
            >
              <span className="text-sm font-semibold text-foreground">{draft.role}</span>
              <Pencil className="h-3 w-3 text-muted-foreground/40 transition-opacity group-hover:opacity-100 opacity-0" />
            </button>
          )}
        </div>

        {/* Primary needs */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Primary Needs
          </span>
          <TagList
            tags={draft.primaryNeeds}
            onRemove={handleRemoveNeed}
            onAdd={handleAddNeed}
            placeholder="add need…"
            accentColor={accentColor}
          />
        </div>

        {/* Annotation focus */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Annotation Focus
            <span className="ml-1.5 font-normal normal-case text-muted-foreground/60">
              objects to highlight
            </span>
          </span>
          <TagList
            tags={draft.annotationFocus}
            onRemove={handleRemoveFocus}
            onAdd={handleAddFocus}
            placeholder="add label…"
          />
        </div>

        {/* Derived annotations */}
        {draft.derivedAnnotations.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setShowDerived((prev) => !prev)}
              className="flex items-center gap-1.5 text-left"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Custom Annotations
              </span>
              <span
                className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                style={{ backgroundColor: `${accentColor}15`, color: accentColor }}
              >
                {draft.derivedAnnotations.length}
              </span>
              {showDerived ? (
                <ChevronUp className="h-3 w-3 text-muted-foreground/50" />
              ) : (
                <ChevronDown className="h-3 w-3 text-muted-foreground/50" />
              )}
            </button>
            {showDerived && (
              <div className="flex flex-col gap-1.5">
                {draft.derivedAnnotations.map((ann, i) => (
                  <DerivedAnnotationRow
                    key={`derived-${i}`}
                    annotation={ann}
                    index={i}
                    onDelete={handleDeleteDerived}
                    onUpdate={handleUpdateDerived}
                    accentColor={accentColor}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Color scheme */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Color Scheme
          </span>
          <div className="flex items-center gap-4">
            <ColorSwatch color={draft.colorScheme.primary} label="Primary" />
            <ColorSwatch color={draft.colorScheme.secondary} label="Secondary" />
            <ColorSwatch color={draft.colorScheme.danger} label="Danger" />
            <p className="ml-1 text-[10px] leading-relaxed text-muted-foreground">
              {draft.narrativeStyle} view
            </p>
          </div>
        </div>

      </div>

      {/* Footer actions */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderTop: `1px solid ${accentColor}18` }}
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Looks off? Describe more
          </button>
        )}
        <button
          type="button"
          onClick={handleConfirm}
          className={cn(
            "flex items-center gap-2 rounded-full px-5 py-2 text-xs font-semibold transition-all",
            "bg-mango text-white hover:bg-mango/90 shadow-sm hover:shadow-md"
          )}
        >
          <Check className="h-3.5 w-3.5" />
          Confirm &amp; Pick Space
        </button>
      </div>
    </div>
  )
}
