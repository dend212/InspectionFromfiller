import { render } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

function Harness() {
  const form = useForm({ defaultValues: { facilityInfo: { facilityName: "" } } });
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="facilityInfo.facilityName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
          </FormItem>
        )}
      />
      <FormItem data-testid="bare" />
    </Form>
  );
}

describe("FormItem data-field-path", () => {
  it("exposes the FormField name and omits it outside a FormField", () => {
    const { getByTestId } = render(<Harness />);
    expect(
      document.querySelector('[data-slot="form-item"][data-field-path="facilityInfo.facilityName"]'),
    ).not.toBeNull();
    expect(getByTestId("bare")).not.toHaveAttribute("data-field-path");
  });
});
