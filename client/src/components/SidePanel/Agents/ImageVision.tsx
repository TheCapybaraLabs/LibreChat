import { Checkbox } from '@librechat/client';
import { Capabilities } from 'librechat-data-provider';
import { useFormContext, Controller } from 'react-hook-form';
import type { AgentForm } from '~/common';
import { useLocalize } from '~/hooks';

const fieldName = Capabilities.image_vision as keyof AgentForm;

export default function ImageVision() {
  const localize = useLocalize();
  const methods = useFormContext<AgentForm>();
  const { control, setValue, getValues } = methods;

  return (
    <div className="flex items-center">
      <Controller
        name={fieldName}
        control={control}
        render={({ field }) => (
          <Checkbox
            ref={field.ref}
            checked={field.value as boolean}
            onCheckedChange={field.onChange}
            className="relative float-left mr-2 inline-flex h-4 w-4 cursor-pointer"
            value={String(field.value)}
            aria-label={localize('com_assistants_image_vision')}
          />
        )}
      />
      <label
        className="form-check-label text-token-text-primary w-full cursor-pointer"
        htmlFor={Capabilities.image_vision}
        onClick={() =>
          setValue(fieldName, !getValues(fieldName), {
            shouldDirty: true,
          })
        }
      >
        <div className="flex items-center">{localize('com_assistants_image_vision')}</div>
      </label>
    </div>
  );
}
