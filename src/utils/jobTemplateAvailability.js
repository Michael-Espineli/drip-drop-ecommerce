export const isActiveJobTemplate = (template) => Boolean(template) && template.isActive !== false && template.active !== false;

export const canUseJobTemplate = (template, { technicianOnly = false } = {}) =>
  isActiveJobTemplate(template) && (!technicianOnly || template.technicianCanAdd === true);
