import { useEffect, useMemo } from 'react';
import { Capabilities } from 'librechat-data-provider';
import { useFormContext, Controller, useWatch } from 'react-hook-form';
import {
  Checkbox,
  HoverCard,
  CircleHelpIcon,
  HoverCardContent,
  HoverCardPortal,
  HoverCardTrigger,
} from '@librechat/client';
import OptionHover from '~/components/SidePanel/Parameters/OptionHover';
import type { AgentForm } from '~/common';
import { useLocalize } from '~/hooks';
import { ESide } from '~/common';
import { cn } from '~/utils/';

const fieldName = Capabilities.retrieval as keyof AgentForm;

export default function Retrieval({ retrievalModels }: { retrievalModels: Set<string> }) {
  const localize = useLocalize();
  const methods = useFormContext<AgentForm>();
  const { control, setValue, getValues } = methods;
  const model = useWatch({ control, name: 'model' });

  const isDisabled = useMemo(() => !retrievalModels.has(model ?? ''), [model, retrievalModels]);

  useEffect(() => {
    if (model && isDisabled) {
      setValue(fieldName, false);
    }
  }, [model, setValue, isDisabled]);

  return (
    <>
      <HoverCard openDelay={50}>
        <div className="flex items-center">
          <Controller
            name={fieldName}
            control={control}
            render={({ field }) => (
              <Checkbox
                ref={field.ref}
                checked={field.value as boolean}
                disabled={isDisabled}
                onCheckedChange={field.onChange}
                className="relative float-left mr-2 inline-flex h-4 w-4 cursor-pointer"
                value={String(field.value)}
                aria-label={localize('com_assistants_file_search')}
              />
            )}
          />
          <div className="flex items-center space-x-2">
            <label
              className={cn(
                'form-check-label text-token-text-primary w-full select-none',
                isDisabled ? 'cursor-no-drop opacity-50' : 'cursor-pointer',
              )}
              htmlFor={Capabilities.retrieval}
              onClick={() =>
                retrievalModels.has(model ?? '') &&
                setValue(fieldName, !getValues(fieldName), {
                  shouldDirty: true,
                })
              }
            >
              {localize('com_assistants_file_search')}
            </label>
            <HoverCardTrigger>
              <CircleHelpIcon className="h-5 w-5 text-text-tertiary" />
            </HoverCardTrigger>
          </div>
          <HoverCardPortal>
            <HoverCardContent side={ESide.Top} disabled={isDisabled} className="ml-16 w-80">
              <div className="space-y-2">
                <p className="text-sm text-text-secondary">
                  {/* // TODO: Add description for file search */}
                </p>
              </div>
            </HoverCardContent>
          </HoverCardPortal>
          <OptionHover
            side={ESide.Top}
            disabled={!isDisabled}
            description="com_assistants_non_retrieval_model"
            langCode={true}
            sideOffset={20}
            className="ml-16"
          />
        </div>
      </HoverCard>
    </>
  );
}
