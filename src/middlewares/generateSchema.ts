import { Request, Response, NextFunction, AsyncRequestHandler } from 'express'
import { base } from './base'
import { SuperGraphRouterEvent, SuperGraphRouterResolver } from '../types'
import { GraphQLResolveInfo } from 'graphql/type/definition'
import { addHelpers } from '../helpers'
import { set, merge } from 'lodash'
import { mergeSchemas } from 'graphql-tools'
import { addMiddleware } from 'graphql-add-middleware'
import { put, get } from 'memory-cache'

export function generateSchema(): AsyncRequestHandler {
  return base(async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    generateSchemaImpl(req)
    next()
  })
}

export function generateSchemaImpl(req: Request) {
  if (Object.keys(req.supergraph.schemas).length === 0) {
    throw new Error('No schemas defined')
  }

  // Only construct schema once
  if (!get('supergraph.mergedSchema')) {
    // Apply router resolvers
    const resolvers = (mergeInfo: any) => {
      const resolverBlocks: Array<any> = req.supergraph.resolvers.map(resolver =>
        generateResolverBlock(mergeInfo, resolver)
      )

      const resolverObject = {}
      merge(resolverObject, ...resolverBlocks)
      return resolverObject
    }

    // MergeSchemas
    const schemasToMerge = Object.keys(req.supergraph.schemas).map(
      key => req.supergraph.schemas[key]
    )

    req.supergraph.schemas.mergedSchema = mergeSchemas({
      schemas: schemasToMerge,
      resolvers
    })

    // Apply router middlewares
    for (const middleware of req.supergraph.middlewares) {
      addMiddleware(req.supergraph.schemas.mergedSchema, middleware.path, middleware.fn)
    }

    put('supergraph.mergedSchema', req.supergraph.schemas.mergedSchema)
  } else {
    req.supergraph.schemas.mergedSchema = get('supergraph.mergedSchema')
  }

  req.supergraph.emit('schemaGenerated', req.supergraph.schemas.mergedSchema)
}

function generateResolverBlock(
  mergeInfo: any,
  resolver: {
    path: string
    resolver: SuperGraphRouterResolver | ((event: SuperGraphRouterEvent) => Promise<any> | any)
  }
): Promise<any> {
  // Create object from path -> apparently, can also use _.set and _.get here :D
  let resolverObject: any = {}

  let resolveFn: any

  if (typeof resolver.resolver === 'function') {
    // This is a 'normal' resolver function
    resolveFn = wrap(resolver.resolver, mergeInfo)
  } else {
    resolveFn = {
      ...resolver.resolver,
      resolve: wrap(resolver.resolver.resolve, mergeInfo)
    }
  }

  set(resolverObject, resolver.path, resolveFn)

  return resolverObject
}

function wrap(fn: ((event: SuperGraphRouterEvent) => Promise<any> | any), mergeInfo: any) {
  return async (
    parent: any,
    args: { [key: string]: any },
    context: { [key: string]: any },
    info: GraphQLResolveInfo
  ) => {
    const event: any = { parent, args, context, info, mergeInfo: mergeInfo }
    addHelpers(event)
    return await fn(event)
  }
}
