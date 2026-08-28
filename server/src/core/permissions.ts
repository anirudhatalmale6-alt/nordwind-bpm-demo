/**
 * Permissions, not roles, in the code.
 *
 * Nothing in this codebase ever asks `if (user.role === 'manager')`. It asks
 * `can(user, 'project.margin.read')`. Roles are named bundles of permissions
 * stored in the database and editable in an admin screen — so when you hire a
 * procurement manager who also needs margin visibility, that is a checkbox, not
 * a code change and a deployment.
 */

export const PERMISSIONS = {
  'project.read': 'View projects and their items',
  'project.write': 'Create and edit projects',
  'project.cost.read': 'View purchase cost figures on a project',
  'project.revenue.read': 'View sell prices and revenue on a project',
  'project.margin.read': 'View profit margin figures',

  'supplier.read': 'View suppliers',
  'supplier.write': 'Create and edit suppliers',

  'rfq.read': 'View RFQs',
  'rfq.write': 'Create and edit RFQs',
  'rfq.issue': 'Issue an RFQ to suppliers',

  'supplier_quote.read': 'View supplier quotations',
  'supplier_quote.write': 'Record supplier quotations',

  'customer_quote.read': 'View customer quotations',
  'customer_quote.write': 'Create customer quotations',

  'po.read': 'View purchase orders',
  'po.create': 'Create purchase orders',
  'po.approve': 'Approve purchase orders',

  'shipment.read': 'View shipments',
  'shipment.write': 'Record shipments and deliveries',

  'audit.read': 'View the activity log',
  'admin.users': 'Manage users, roles and permissions',
} as const

export type PermissionKey = keyof typeof PERMISSIONS

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[]

/**
 * The seeded role bundles for the demo. In the real system these live in
 * role_permissions and are edited through the admin screen; this constant is
 * only the starting point the seed loads.
 */
export const ROLE_BUNDLES: Record<string, { name: string; description: string; perms: PermissionKey[] }> = {
  management: {
    name: 'Management',
    description: 'Full visibility including costs, sell prices and margin. Approves purchase orders.',
    perms: ALL_PERMISSIONS,
  },

  purchasing: {
    name: 'Purchasing',
    description:
      'Runs the RFQ cycle and raises purchase orders. Sees what things cost to buy, but not what they are sold for, and therefore cannot derive margin.',
    perms: [
      'project.read',
      'project.cost.read',
      'supplier.read',
      'supplier.write',
      'rfq.read',
      'rfq.write',
      'rfq.issue',
      'supplier_quote.read',
      'supplier_quote.write',
      'po.read',
      'po.create',
      'shipment.read',
      'audit.read',
    ],
  },

  logistics: {
    name: 'Logistics',
    description:
      'Tracks shipments and deliveries against approved POs. Sees quantities and dates, but no prices at all.',
    perms: ['project.read', 'po.read', 'shipment.read', 'shipment.write', 'supplier.read'],
  },
}

export function can(perms: ReadonlySet<string>, key: PermissionKey): boolean {
  return perms.has(key)
}
