"use client";

import type { Label as LabelPrimitive } from "radix-ui";
import { Slot } from "radix-ui";
import * as React from "react";
import {
  Controller,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
  FormProvider,
  useFormContext,
  useFormState,
} from "react-hook-form";
import { ProvenanceBadge } from "@/components/prefill/provenance-badge";
import { SuggestionChip } from "@/components/prefill/suggestion-chip";
import { useProvenance } from "@/components/prefill/provenance-context";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
};

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext.name });
  const fieldState = getFieldState(fieldContext.name, formState);

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>");
  }

  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
};

type FormItemContextValue = {
  id: string;
};

const FormItemContext = React.createContext<FormItemContextValue>({} as FormItemContextValue);

type FormFieldGroupContextValue = {
  /** Field path shared by every control in the group */
  name: string;
};

const FormFieldGroupContext = React.createContext<FormFieldGroupContextValue | null>(null);

/** True when `fieldName` is the path a surrounding FormFieldGroup already badges/chips */
function useIsGroupMember(fieldName: string | undefined): boolean {
  const group = React.useContext(FormFieldGroupContext);
  return !!fieldName && group?.name === fieldName;
}

function FormItem({ className, children, ...props }: React.ComponentProps<"div">) {
  const id = React.useId();
  // FormItem is normally rendered inside a FormField; outside one the context is empty
  const fieldContext = React.useContext(FormFieldContext);
  const fieldName = fieldContext?.name;
  const { entry } = useProvenance(fieldName);
  // A checkbox group renders one FormItem per option for the same path — the group owns the chip
  const inGroup = useIsGroupMember(fieldName);

  return (
    <FormItemContext.Provider value={{ id }}>
      <div
        data-slot="form-item"
        data-field-path={fieldName}
        // min-w-0: a grid item defaults to min-width:auto, so a long suggestion chip would
        // otherwise widen the parent's column track and overflow the card.
        className={cn("grid min-w-0 gap-2", className)}
        {...props}
      >
        {children}
        {fieldName && !inGroup && entry?.state === "suggested" ? (
          <SuggestionChip fieldPath={fieldName} />
        ) : null}
      </div>
    </FormItemContext.Provider>
  );
}

function FormLabel({
  className,
  children,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  const { error, formItemId, name } = useFormField();
  const inGroup = useIsGroupMember(name);

  // The badge is a <button>: rendered as a sibling of the <label>, not inside it, so
  // the control's accessible name is only the label text (and the markup stays valid).
  return (
    <span className="inline-flex items-center gap-2">
      <Label
        data-slot="form-label"
        data-error={!!error}
        className={cn("data-[error=true]:text-destructive", className)}
        htmlFor={formItemId}
        {...props}
      >
        {children}
      </Label>
      {!inGroup && <ProvenanceBadge fieldPath={name} />}
    </span>
  );
}

interface FormFieldGroupProps extends Omit<React.ComponentProps<"div">, "children"> {
  /** Field path every control in the group writes to (e.g. an array of selected options) */
  name: string;
  /** Group heading; the provenance badge sits beside it */
  label: React.ReactNode;
  /** Element used for the heading text (headings keep their outline level) */
  labelAs?: "span" | "h3" | "h4";
  labelClassName?: string;
  /** Rendered between the heading and the options (e.g. a FormDescription) */
  description?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * A group of controls that all edit ONE field path (checkbox groups). FormItem/FormLabel
 * rendered inside it for that path render neither chip nor badge; the group renders both
 * exactly once — the badge beside the group label, the suggestion chip after the last option.
 */
function FormFieldGroup({
  name,
  label,
  labelAs: LabelTag = "span",
  labelClassName,
  description,
  className,
  children,
  ...props
}: FormFieldGroupProps) {
  const labelId = React.useId();
  const { entry } = useProvenance(name);

  return (
    <FormFieldGroupContext.Provider value={{ name }}>
      <div
        role="group"
        aria-labelledby={labelId}
        data-slot="form-field-group"
        data-field-path={name}
        className={cn("min-w-0", className)}
        {...props}
      >
        {/* A div, not FormLabel's inline span: the heading tags are flow content */}
        <div className="flex items-center gap-2">
          <LabelTag
            id={labelId}
            data-slot="form-field-group-label"
            className={cn("text-sm font-medium leading-none", labelClassName)}
          >
            {label}
          </LabelTag>
          <ProvenanceBadge fieldPath={name} />
        </div>
        {description}
        {children}
        {entry?.state === "suggested" ? <SuggestionChip fieldPath={name} /> : null}
      </div>
    </FormFieldGroupContext.Provider>
  );
}

interface FormCheckboxRowProps extends Omit<React.ComponentProps<"div">, "children"> {
  /** The checkbox; the row wraps it in FormControl so it gets the field's id/aria wiring */
  control: React.ReactElement;
  /** Control before the text (default) or trailing at the row's end */
  controlPosition?: "start" | "end";
  /** Extra classes for the <label> text */
  labelClassName?: string;
  /** Label text */
  children: React.ReactNode;
}

/**
 * Bordered tap-target row for a boolean field: control + label text + provenance badge.
 * The badge is a sibling of the <label> (never inside it — a button inside a label pollutes
 * the control's accessible name), placed right after the label text; the label is associated
 * to the control via htmlFor so clicking the text still toggles it, and it stretches to fill
 * the row so the whole row stays a tap target.
 */
function FormCheckboxRow({
  control,
  controlPosition = "start",
  labelClassName,
  className,
  children,
  ...props
}: FormCheckboxRowProps) {
  const { formItemId, name } = useFormField();
  const inGroup = useIsGroupMember(name);
  const wrappedControl = <FormControl>{control}</FormControl>;

  return (
    <div
      data-slot="form-checkbox-row"
      className={cn(
        "flex min-h-[48px] items-center gap-3 rounded-lg border px-3",
        controlPosition === "end" && "justify-between",
        className,
      )}
      {...props}
    >
      {controlPosition === "start" && wrappedControl}
      <label
        htmlFor={formItemId}
        className={cn(
          "flex min-h-[48px] flex-1 cursor-pointer items-center self-stretch py-3 text-base",
          labelClassName,
        )}
      >
        {children}
      </label>
      {!inGroup && <ProvenanceBadge fieldPath={name} />}
      {controlPosition === "end" && wrappedControl}
    </div>
  );
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot.Root>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();

  return (
    <Slot.Root
      data-slot="form-control"
      id={formItemId}
      aria-describedby={!error ? `${formDescriptionId}` : `${formDescriptionId} ${formMessageId}`}
      aria-invalid={!!error}
      {...props}
    />
  );
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();

  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function FormMessage({ className, ...props }: React.ComponentProps<"p">) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error?.message ?? "") : props.children;

  if (!body) {
    return null;
  }

  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      className={cn("text-destructive text-sm", className)}
      {...props}
    >
      {body}
    </p>
  );
}

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
  FormFieldGroup,
  FormCheckboxRow,
};
